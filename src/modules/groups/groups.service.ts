import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { CategoryName } from '@/common/constants/categories';
import { toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { PublicTransaction, TransactionsService } from '@/modules/transactions/transactions.service';
import { AddGroupExpenseDto } from './dto/add-group-expense.dto';
import { ConfirmGroupExpenseDto } from './dto/confirm-group-expense.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { JoinGroupDto } from './dto/join-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateGroupExpenseDto } from './dto/update-group-expense.dto';
import { RecordSettlementDto } from './dto/record-settlement.dto';
import { DebtSimplificationService, MemberBalance } from './services/debt-simplification.service';
import { ExpenseGroup, ExpenseGroupDocument } from './schemas/expense-group.schema';
import { GroupExpense, GroupExpenseDocument } from './schemas/group-expense.schema';

/** Best-effort default so the confirm sheet doesn't start on "Other" — the user can still pick
 * any category before confirming. */
const GROUP_CATEGORY_SUGGESTION: Record<string, CategoryName> = {
  Travel: 'Travel',
  'Home & Utilities': 'Bills',
  'Event & Party': 'Entertainment',
  'Office & Work': 'Other',
  Other: 'Other',
};

export interface PublicGroupMember {
  id: string;
  name: string;
  phone?: string;
  linkedUserId?: string | null;
  status?: 'ghost' | 'registered';
  isCurrentUser?: boolean;
}

export interface PublicGroupExpenseSplit {
  memberName: string;
  amount: number;
  confirmedTransactionId?: string;
}

export interface PublicGroupExpense {
  id: string;
  groupId: string;
  title: string;
  totalAmount: number;
  paidBy: string;
  date: string;
  splits: PublicGroupExpenseSplit[];
  splitType?: string;
  notes?: string;
  isSettlement?: boolean;
  settlementFrom?: string;
  settlementTo?: string;
}

export interface PublicExpenseGroup {
  id: string;
  name: string;
  category: string;
  inviteCode: string;
  isOwner: boolean;
  currentMemberName: string;
  members: PublicGroupMember[];
  expenses: PublicGroupExpense[];
  createdAt: string;
}

export interface GroupInvitePreview {
  id: string;
  name: string;
  category: string;
  inviteCode: string;
  members: { id: string; name: string; isClaimed: boolean }[];
}

export interface GroupBalances {
  groupId: string;
  totalGroupSpendMinor: number;
  members: { name: string; netMinor: number }[];
  settlements: { from: string; to: string; amountMinor: number }[];
}

export interface PendingGroupConfirmation {
  groupId: string;
  groupName: string;
  expenseId: string;
  title: string;
  date: string;
  amount: number;
  paidBy: string;
  isPayer: boolean;
  suggestedCategory: CategoryName;
}

const SPLIT_SUM_TOLERANCE_MINOR = 100; // ₹1

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(ExpenseGroup.name) private readonly groupModel: Model<ExpenseGroupDocument>,
    @InjectModel(GroupExpense.name) private readonly expenseModel: Model<GroupExpenseDocument>,
    private readonly debtSimplificationService: DebtSimplificationService,
    private readonly notificationsService: NotificationsService,
    private readonly transactionsService: TransactionsService,
  ) {}

  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'TK';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private async broadcastGroupActivity(
    group: ExpenseGroupDocument,
    actorUserId: string,
    title: string,
    message: string,
  ) {
    const recipientUserIds = new Set<string>();
    if (group.userId.toString() !== actorUserId) {
      recipientUserIds.add(group.userId.toString());
    }
    for (const m of group.members) {
      if (m.linkedUserId && m.linkedUserId.toString() !== actorUserId) {
        recipientUserIds.add(m.linkedUserId.toString());
      }
    }

    for (const targetUserId of recipientUserIds) {
      void this.notificationsService.create(targetUserId, {
        title,
        message,
        type: 'activity',
      }).catch(() => {});
    }
  }

  async findAll(userId: string): Promise<PublicExpenseGroup[]> {
    const userObjId = new Types.ObjectId(userId);
    const groups = await this.groupModel
      .find({
        $or: [
          { userId: userObjId },
          { 'members.linkedUserId': userObjId },
        ],
      })
      .sort({ createdAt: -1 })
      .exec();

    if (groups.length === 0) return [];

    // Ensure all groups have an invite code
    for (const group of groups) {
      if (!group.inviteCode) {
        group.inviteCode = this.generateInviteCode();
        await group.save();
      }
    }

    const groupIds = groups.map((g) => g._id);
    const expenses = await this.expenseModel
      .find({ groupId: { $in: groupIds } })
      .sort({ date: -1, createdAt: -1 })
      .exec();

    return groups.map((group) =>
      this.assemble(
        group,
        expenses.filter((e) => e.groupId.equals(group._id)),
        userId,
      ),
    );
  }

  async create(userId: string, dto: CreateGroupDto): Promise<PublicExpenseGroup> {
    const userObjId = new Types.ObjectId(userId);
    let inviteCode = this.generateInviteCode();
    while (await this.groupModel.findOne({ inviteCode }).exec()) {
      inviteCode = this.generateInviteCode();
    }

    const members = dto.members.map((m) => {
      const isOwnerMember = m.name.trim().toLowerCase() === 'you';
      return {
        id: randomUUID(),
        name: m.name.trim(),
        phone: m.phone?.trim() || undefined,
        linkedUserId: isOwnerMember ? userObjId : null,
        status: isOwnerMember ? ('registered' as const) : ('ghost' as const),
      };
    });

    if (!members.some((m) => m.linkedUserId && m.linkedUserId.equals(userObjId))) {
      members.unshift({
        id: randomUUID(),
        name: 'You',
        phone: undefined,
        linkedUserId: userObjId,
        status: 'registered' as const,
      });
    }

    const group = await this.groupModel.create({
      userId: userObjId,
      name: dto.name.trim(),
      category: dto.category,
      inviteCode,
      members,
    });

    return this.assemble(group, [], userId);
  }

  async previewInvite(inviteCode: string): Promise<GroupInvitePreview> {
    const cleanCode = inviteCode.trim().toUpperCase();
    const group = await this.groupModel.findOne({ inviteCode: cleanCode }).exec();
    if (!group) throw new NotFoundException('Invalid or expired invite code');

    return {
      id: group._id.toString(),
      name: group.name,
      category: group.category,
      inviteCode: group.inviteCode || cleanCode,
      members: group.members.map((m) => ({
        id: m.id,
        name: m.name,
        isClaimed: Boolean(m.linkedUserId),
      })),
    };
  }

  async joinGroup(userId: string, dto: JoinGroupDto): Promise<PublicExpenseGroup> {
    const cleanCode = dto.inviteCode.trim().toUpperCase();
    const group = await this.groupModel.findOne({ inviteCode: cleanCode }).exec();
    if (!group) throw new NotFoundException('Invalid or expired invite code');

    const userObjId = new Types.ObjectId(userId);
    const alreadyLinked =
      group.userId.equals(userObjId) ||
      group.members.some((m) => m.linkedUserId && m.linkedUserId.equals(userObjId));

    if (alreadyLinked) {
      const expenses = await this.expenseModel.find({ groupId: group._id }).sort({ date: -1, createdAt: -1 }).exec();
      return this.assemble(group, expenses, userId);
    }

    let joinedMemberName = '';
    if (dto.memberId) {
      const member = group.members.find((m) => m.id === dto.memberId);
      if (!member) throw new BadRequestException('Selected member does not exist in this group');
      if (member.linkedUserId && !member.linkedUserId.equals(userObjId)) {
        throw new BadRequestException(`Member "${member.name}" is already linked to another account.`);
      }
      member.linkedUserId = userObjId;
      member.status = 'registered';
      joinedMemberName = member.name;
    } else if (dto.memberName) {
      const name = dto.memberName.trim();
      const newMember = {
        id: randomUUID(),
        name,
        phone: undefined,
        linkedUserId: userObjId,
        status: 'registered' as const,
      };
      group.members.push(newMember as any);
      joinedMemberName = name;
    } else {
      throw new BadRequestException('Please specify which member you are, or provide a member name.');
    }

    await group.save();

    void this.broadcastGroupActivity(
      group,
      userId,
      'Member Joined Group',
      `"${joinedMemberName}" joined ${group.name} using the invite code!`,
    );

    const expenses = await this.expenseModel.find({ groupId: group._id }).sort({ date: -1, createdAt: -1 }).exec();
    return this.assemble(group, expenses, userId);
  }

  async update(
    userId: string,
    groupId: string,
    dto: UpdateGroupDto,
  ): Promise<PublicExpenseGroup> {
    const group = await this.findOwnedGroup(userId, groupId);

    if (dto.name !== undefined) {
      group.name = dto.name.trim();
    }
    if (dto.category !== undefined) {
      group.category = dto.category;
    }
    if (dto.members !== undefined) {
      const existingMembersMap = new Map(group.members.map((m) => [m.name.toLowerCase(), m]));
      const newMembers = dto.members.map((m) => {
        const existing = existingMembersMap.get(m.name.toLowerCase());
        return {
          id: existing ? existing.id : randomUUID(),
          name: m.name.trim(),
          phone: m.phone?.trim() || existing?.phone,
          linkedUserId: existing ? existing.linkedUserId : null,
          status: existing ? existing.status : ('ghost' as const),
        };
      });

      // Ensure "You" or owner is present in members
      if (!newMembers.some((m) => m.name.toLowerCase() === 'you')) {
        newMembers.unshift({
          id: randomUUID(),
          name: 'You',
          phone: undefined,
          linkedUserId: new Types.ObjectId(userId),
          status: 'registered' as const,
        });
      }

      // Check if any deleted member has existing expenses/splits
      const newMemberNames = new Set(newMembers.map((m) => m.name.toLowerCase()));
      const expenses = await this.expenseModel.find({ groupId: group._id }).exec();
      for (const exp of expenses) {
        if (!newMemberNames.has(exp.paidBy.toLowerCase())) {
          throw new BadRequestException(
            `Cannot remove "${exp.paidBy}" because they have recorded expenses in this group.`,
          );
        }
        for (const split of exp.splits) {
          if (!newMemberNames.has(split.memberName.toLowerCase())) {
            throw new BadRequestException(
              `Cannot remove "${split.memberName}" because they are part of expense splits in this group.`,
            );
          }
        }
      }

      group.members = newMembers as any;
    }

    if (!group.inviteCode) {
      group.inviteCode = this.generateInviteCode();
    }

    await group.save();

    const expenses = await this.expenseModel
      .find({ groupId: group._id })
      .sort({ date: -1, createdAt: -1 })
      .exec();

    return this.assemble(group, expenses, userId);
  }

  async remove(userId: string, groupId: string): Promise<void> {
    const group = await this.findOwnedGroup(userId, groupId);
    await this.expenseModel.deleteMany({ groupId: group._id }).exec();
    await group.deleteOne();
  }

  async deleteAllForUser(userId: string): Promise<void> {
    const userObjId = new Types.ObjectId(userId);
    const groups = await this.groupModel.find({ userId: userObjId }).exec();
    const groupIds = groups.map((g) => g._id);
    await this.expenseModel.deleteMany({ groupId: { $in: groupIds } }).exec();
    await this.groupModel.deleteMany({ userId: userObjId }).exec();
  }

  async addExpense(
    userId: string,
    groupId: string,
    dto: AddGroupExpenseDto,
  ): Promise<PublicGroupExpense> {
    const group = await this.findGroupForUser(userId, groupId);

    const memberNames = new Set(group.members.map((m) => m.name));
    if (!memberNames.has(dto.paidBy)) {
      throw new BadRequestException(`"${dto.paidBy}" is not a member of this group.`);
    }
    for (const split of dto.splits) {
      if (!memberNames.has(split.memberName)) {
        throw new BadRequestException(`"${split.memberName}" is not a member of this group.`);
      }
    }

    const totalAmountMinor = toMinorUnits(dto.totalAmount);
    const splitsMinor = dto.splits.map((s) => ({
      memberName: s.memberName,
      amountMinor: toMinorUnits(s.amount),
    }));
    const splitSum = splitsMinor.reduce((acc, s) => acc + s.amountMinor, 0);

    if (Math.abs(splitSum - totalAmountMinor) > SPLIT_SUM_TOLERANCE_MINOR) {
      throw new BadRequestException('Split amounts must add up to the total bill amount.');
    }

    const expense = await this.expenseModel.create({
      groupId: group._id,
      userId,
      title: dto.title,
      totalAmountMinor,
      paidBy: dto.paidBy,
      date: dto.date,
      splits: splitsMinor,
      splitType: dto.splitType,
      notes: dto.notes,
    });

    void this.broadcastGroupActivity(
      group,
      userId,
      'Group Expense Added',
      `${dto.paidBy} added "${dto.title}" (₹${dto.totalAmount}) in ${group.name}`,
    );

    return this.toPublicExpense(expense);
  }

  async updateExpense(
    userId: string,
    groupId: string,
    expenseId: string,
    dto: UpdateGroupExpenseDto,
  ): Promise<PublicGroupExpense> {
    const group = await this.findGroupForUser(userId, groupId);
    const expense = await this.expenseModel.findOne({ _id: expenseId, groupId: group._id }).exec();
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    const memberNames = new Set(group.members.map((m) => m.name));
    if (dto.paidBy && !memberNames.has(dto.paidBy)) {
      throw new BadRequestException(`"${dto.paidBy}" is not a member of this group.`);
    }
    if (dto.splits) {
      for (const split of dto.splits) {
        if (!memberNames.has(split.memberName)) {
          throw new BadRequestException(`"${split.memberName}" is not a member of this group.`);
        }
      }
    }

    const oldTitle = expense.title;
    const oldAmount = toMajorUnits(expense.totalAmountMinor);
    const oldPaidBy = expense.paidBy;
    const oldDate = expense.date;
    const oldSplitType = expense.splitType || 'equal';
    const oldSplits = (expense.splits || []).map((s) => ({
      memberName: s.memberName,
      amount: toMajorUnits(s.amountMinor),
    }));

    const changes: string[] = [];

    if (dto.title !== undefined && dto.title !== oldTitle) {
      changes.push(`Title: "${oldTitle}" → "${dto.title}"`);
      expense.title = dto.title;
    }
    if (dto.totalAmount !== undefined && dto.totalAmount !== oldAmount) {
      changes.push(`Amount: ₹${oldAmount} → ₹${dto.totalAmount}`);
    }
    if (dto.paidBy !== undefined && dto.paidBy !== oldPaidBy) {
      changes.push(`Paid by: ${oldPaidBy} → ${dto.paidBy}`);
      expense.paidBy = dto.paidBy;
    }
    if (dto.date !== undefined && dto.date !== oldDate) {
      changes.push(`Date: ${oldDate} → ${dto.date}`);
      expense.date = dto.date;
    }
    if (dto.splitType !== undefined && dto.splitType !== oldSplitType) {
      changes.push(`Split Type: ${oldSplitType} → ${dto.splitType}`);
      expense.splitType = dto.splitType;
    }
    if (dto.notes !== undefined && dto.notes !== expense.notes) {
      changes.push(`Notes: ${expense.notes || 'none'} → ${dto.notes || 'none'}`);
      expense.notes = dto.notes;
    }

    if (dto.totalAmount !== undefined || dto.splits !== undefined) {
      const totalAmountMinor = dto.totalAmount !== undefined ? toMinorUnits(dto.totalAmount) : expense.totalAmountMinor;
      const splitsMinor = dto.splits !== undefined
        ? dto.splits.map((s) => ({
            memberName: s.memberName,
            amountMinor: toMinorUnits(s.amount),
          }))
        : expense.splits;

      const splitSum = splitsMinor.reduce((acc, s) => acc + s.amountMinor, 0);
      if (Math.abs(splitSum - totalAmountMinor) > SPLIT_SUM_TOLERANCE_MINOR) {
        throw new BadRequestException('Split amounts must add up to the total bill amount.');
      }

      if (dto.splits !== undefined) {
        const oldMap = new Map(oldSplits.map((s) => [s.memberName, s.amount]));
        const newMap = new Map(dto.splits.map((s) => [s.memberName, s.amount]));

        const splitChanges: string[] = [];
        for (const [member, newAmt] of newMap.entries()) {
          const prevAmt = oldMap.get(member);
          if (prevAmt === undefined) {
            splitChanges.push(`+${member} added (₹${newAmt})`);
          } else if (Math.abs(prevAmt - newAmt) > 0.01) {
            splitChanges.push(`${member}: ₹${prevAmt} → ₹${newAmt}`);
          }
        }
        for (const [member, prevAmt] of oldMap.entries()) {
          if (!newMap.has(member)) {
            splitChanges.push(`-${member} removed (was ₹${prevAmt})`);
          }
        }
        if (splitChanges.length > 0) {
          changes.push(`Splits: ${splitChanges.join(', ')}`);
        }
      }

      expense.totalAmountMinor = totalAmountMinor;
      expense.splits = splitsMinor as any;
    }

    await expense.save();

    const changeSummary = changes.length > 0
      ? `Updated in "${group.name}":\n• ${changes.join('\n• ')}`
      : `Updated "${expense.title}" (₹${toMajorUnits(expense.totalAmountMinor)}) in ${group.name}`;

    void this.broadcastGroupActivity(
      group,
      userId,
      `Group Expense Updated: "${expense.title}"`,
      changeSummary,
    );

    return this.toPublicExpense(expense);
  }

  async deleteExpense(userId: string, groupId: string, expenseId: string): Promise<void> {
    const group = await this.findGroupForUser(userId, groupId);
    const expense = await this.expenseModel.findOne({ _id: expenseId, groupId: group._id }).exec();
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }

    const title = expense.title;
    const amount = toMajorUnits(expense.totalAmountMinor);
    const paidBy = expense.paidBy;
    const splitCount = expense.splits?.length || 0;
    await expense.deleteOne();

    void this.broadcastGroupActivity(
      group,
      userId,
      `Group Expense Deleted: "${title}"`,
      `Deleted from "${group.name}":\n• Previous Amount: ₹${amount}\n• Paid by: ${paidBy}\n• Involved: ${splitCount} members (balances recalculated)`,
    );
  }

  async recordSettlement(
    userId: string,
    groupId: string,
    dto: RecordSettlementDto,
  ): Promise<PublicGroupExpense> {
    const group = await this.findGroupForUser(userId, groupId);
    const memberNames = new Set(group.members.map((m) => m.name));

    if (!memberNames.has(dto.fromMember) || !memberNames.has(dto.toMember)) {
      throw new BadRequestException('Both parties in a settlement must be members of this group.');
    }

    const amountMinor = toMinorUnits(dto.amount);
    const expense = await this.expenseModel.create({
      groupId: group._id,
      userId,
      title: `${dto.fromMember} paid ${dto.toMember}`,
      totalAmountMinor: amountMinor,
      paidBy: dto.fromMember,
      date: new Date().toISOString().split('T')[0],
      splits: [{ memberName: dto.toMember, amountMinor }],
      isSettlement: true,
      settlementFrom: dto.fromMember,
      settlementTo: dto.toMember,
      notes: dto.notes ?? 'Settlement payment',
    });

    void this.broadcastGroupActivity(
      group,
      userId,
      'Group Settlement Recorded',
      `${dto.fromMember} paid ${dto.toMember} ₹${dto.amount} in ${group.name}`,
    );

    return this.toPublicExpense(expense);
  }

  async getBalances(userId: string, groupId: string): Promise<GroupBalances> {
    const group = await this.findGroupForUser(userId, groupId);
    const expenses = await this.expenseModel.find({ groupId: group._id }).exec();

    const balances = new Map<string, number>();
    group.members.forEach((m) => balances.set(m.name, 0));

    let totalGroupSpendMinor = 0;
    for (const expense of expenses) {
      balances.set(expense.paidBy, (balances.get(expense.paidBy) ?? 0) + expense.totalAmountMinor);
      for (const split of expense.splits) {
        balances.set(split.memberName, (balances.get(split.memberName) ?? 0) - split.amountMinor);
      }
      if (!expense.isSettlement) totalGroupSpendMinor += expense.totalAmountMinor;
    }

    const memberBalances: MemberBalance[] = Array.from(balances.entries()).map(
      ([name, netMinor]) => ({ name, netMinor }),
    );
    const settlements = this.debtSimplificationService.simplify(memberBalances);

    return { groupId, totalGroupSpendMinor, members: memberBalances, settlements };
  }

  /** Every one of the current user's own split lines, across every group they can access
   * (owned or joined), that hasn't yet been turned into a personal transaction. Settlements
   * are excluded — they're debt repayments, not new spend. */
  async getPendingConfirmations(userId: string): Promise<PendingGroupConfirmation[]> {
    const userObjId = new Types.ObjectId(userId);
    const groups = await this.groupModel
      .find({ $or: [{ userId: userObjId }, { 'members.linkedUserId': userObjId }] })
      .exec();
    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g._id);
    const expenses = await this.expenseModel
      .find({ groupId: { $in: groupIds }, isSettlement: { $ne: true } })
      .sort({ date: -1, createdAt: -1 })
      .exec();

    const groupById = new Map(groups.map((g) => [g._id.toString(), g]));
    const pending: PendingGroupConfirmation[] = [];

    for (const expense of expenses) {
      const group = groupById.get(expense.groupId.toString());
      if (!group) continue;

      const myNames = new Set(
        group.members.filter((m) => m.linkedUserId?.equals(userObjId)).map((m) => m.name),
      );
      if (myNames.size === 0) continue;

      for (const split of expense.splits) {
        if (!myNames.has(split.memberName) || split.confirmedTransactionId) continue;
        pending.push({
          groupId: group._id.toString(),
          groupName: group.name,
          expenseId: expense._id.toString(),
          title: expense.title,
          date: expense.date,
          amount: toMajorUnits(split.amountMinor),
          paidBy: expense.paidBy,
          isPayer: expense.paidBy === split.memberName,
          suggestedCategory: GROUP_CATEGORY_SUGGESTION[group.category] ?? 'Other',
        });
      }
    }

    return pending;
  }

  /** Logs the current user's own share of a group expense as a personal transaction, then
   * marks that split confirmed so it's never double-counted. */
  async confirmExpenseSplit(
    userId: string,
    groupId: string,
    expenseId: string,
    dto: ConfirmGroupExpenseDto,
  ): Promise<PublicTransaction> {
    const group = await this.findGroupForUser(userId, groupId);
    const expense = await this.expenseModel.findOne({ _id: expenseId, groupId: group._id }).exec();
    if (!expense) throw new NotFoundException('Expense not found');

    const userObjId = new Types.ObjectId(userId);
    const myNames = new Set(
      group.members.filter((m) => m.linkedUserId?.equals(userObjId)).map((m) => m.name),
    );

    const splitIndex = expense.splits.findIndex((s) => myNames.has(s.memberName) && !s.confirmedTransactionId);
    if (splitIndex === -1) {
      throw new NotFoundException('No unconfirmed share of this expense belongs to you.');
    }

    const transaction = await this.transactionsService.create(userId, {
      title: expense.title,
      merchant: group.name,
      amount: toMajorUnits(expense.splits[splitIndex].amountMinor),
      type: 'expense',
      category: dto.category,
      date: expense.date,
      paymentMethod: 'Cash',
      notes: `Confirmed from group "${group.name}"${expense.notes ? ` — ${expense.notes}` : ''}`,
    });

    // Reassign the whole array (rather than mutating the subdocument in place) to match this
    // service's established persistence pattern for `splits` elsewhere (see updateExpense).
    expense.splits = expense.splits.map((s, i) =>
      i === splitIndex
        ? { memberName: s.memberName, amountMinor: s.amountMinor, confirmedTransactionId: transaction.id }
        : s,
    );
    await expense.save();

    return transaction;
  }

  private async findOwnedGroup(userId: string, groupId: string): Promise<ExpenseGroupDocument> {
    const group = await this.groupModel.findById(groupId).exec();
    if (!group) throw new NotFoundException('Group not found');
    if (group.userId.toString() !== userId)
      throw new ForbiddenException('You do not own this group');
    return group;
  }

  private async findGroupForUser(userId: string, groupId: string): Promise<ExpenseGroupDocument> {
    const group = await this.groupModel.findById(groupId).exec();
    if (!group) throw new NotFoundException('Group not found');
    const userObjId = new Types.ObjectId(userId);
    const isOwner = group.userId.equals(userObjId);
    const isLinked = group.members.some((m) => m.linkedUserId && m.linkedUserId.equals(userObjId));
    if (!isOwner && !isLinked) {
      throw new ForbiddenException('You do not have access to this group');
    }
    return group;
  }

  private assemble(
    group: ExpenseGroupDocument,
    expenses: GroupExpenseDocument[],
    currentUserId?: string,
  ): PublicExpenseGroup {
    const userObjId = currentUserId ? new Types.ObjectId(currentUserId) : null;
    const isOwner = userObjId ? group.userId.equals(userObjId) : false;

    let currentMember = group.members.find((m) => userObjId && m.linkedUserId && m.linkedUserId.equals(userObjId));
    if (!currentMember && isOwner) {
      currentMember = group.members.find((m) => m.name.toLowerCase() === 'you');
    }
    const currentMemberName = currentMember ? currentMember.name : (isOwner ? 'You' : '');

    return {
      id: group._id.toString(),
      name: group.name,
      category: group.category,
      inviteCode: group.inviteCode || '',
      isOwner,
      currentMemberName,
      members: group.members.map((m) => ({
        id: m.id,
        name: m.name,
        phone: m.phone,
        linkedUserId: m.linkedUserId ? m.linkedUserId.toString() : null,
        status: m.status,
        isCurrentUser: Boolean(
          (userObjId && m.linkedUserId && m.linkedUserId.equals(userObjId)) ||
          (isOwner && m.name.toLowerCase() === 'you')
        ),
      })),
      expenses: expenses.map((e) => this.toPublicExpense(e)),
      createdAt: group.createdAt.toISOString().split('T')[0],
    };
  }

  private toPublicExpense(doc: GroupExpenseDocument): PublicGroupExpense {
    return {
      id: doc._id.toString(),
      groupId: doc.groupId.toString(),
      title: doc.title,
      totalAmount: toMajorUnits(doc.totalAmountMinor),
      paidBy: doc.paidBy,
      date: doc.date,
      splits: doc.splits.map((s) => ({
        memberName: s.memberName,
        amount: toMajorUnits(s.amountMinor),
        confirmedTransactionId: s.confirmedTransactionId,
      })),
      splitType: doc.splitType,
      notes: doc.notes,
      isSettlement: doc.isSettlement,
      settlementFrom: doc.settlementFrom,
      settlementTo: doc.settlementTo,
    };
  }
}
