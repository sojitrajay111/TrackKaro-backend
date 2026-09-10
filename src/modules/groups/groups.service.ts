import { randomUUID } from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { AddGroupExpenseDto } from './dto/add-group-expense.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { RecordSettlementDto } from './dto/record-settlement.dto';
import { DebtSimplificationService, MemberBalance } from './services/debt-simplification.service';
import { ExpenseGroup, ExpenseGroupDocument } from './schemas/expense-group.schema';
import { GroupExpense, GroupExpenseDocument } from './schemas/group-expense.schema';

export interface PublicGroupMember {
  id: string;
  name: string;
  phone?: string;
}

export interface PublicGroupExpenseSplit {
  memberName: string;
  amount: number;
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
  members: PublicGroupMember[];
  expenses: PublicGroupExpense[];
  createdAt: string;
}

export interface GroupBalances {
  groupId: string;
  totalGroupSpendMinor: number;
  members: { name: string; netMinor: number }[];
  settlements: { from: string; to: string; amountMinor: number }[];
}

// Splits are pre-rounded per-member on the client; allow a small tolerance for the sum to
// deviate from the total (e.g. ₹100 / 3 leaves a paisa or two of rounding slack) rather than
// rejecting legitimate client-computed splits.
const SPLIT_SUM_TOLERANCE_MINOR = 100; // ₹1

@Injectable()
export class GroupsService {
  constructor(
    @InjectModel(ExpenseGroup.name) private readonly groupModel: Model<ExpenseGroupDocument>,
    @InjectModel(GroupExpense.name) private readonly expenseModel: Model<GroupExpenseDocument>,
    private readonly debtSimplificationService: DebtSimplificationService,
  ) {}

  async findAll(userId: string): Promise<PublicExpenseGroup[]> {
    const groups = await this.groupModel.find({ userId }).sort({ createdAt: -1 }).exec();
    if (groups.length === 0) return [];

    const groupIds = groups.map((g) => g._id);
    const expenses = await this.expenseModel
      .find({ groupId: { $in: groupIds } })
      .sort({ date: -1, createdAt: -1 })
      .exec();

    return groups.map((group) =>
      this.assemble(
        group,
        expenses.filter((e) => e.groupId.equals(group._id)),
      ),
    );
  }

  async create(userId: string, dto: CreateGroupDto): Promise<PublicExpenseGroup> {
    const members = dto.members.map((m) => ({
      id: randomUUID(),
      name: m.name,
      phone: m.phone,
      status: 'ghost' as const,
    }));

    const group = await this.groupModel.create({
      userId,
      name: dto.name,
      category: dto.category,
      members,
    });
    return this.assemble(group, []);
  }

  async remove(userId: string, groupId: string): Promise<void> {
    const group = await this.findOwnedGroup(userId, groupId);
    await this.expenseModel.deleteMany({ groupId: group._id }).exec();
    await group.deleteOne();
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.expenseModel.deleteMany({ userId }).exec();
    await this.groupModel.deleteMany({ userId }).exec();
  }

  async addExpense(
    userId: string,
    groupId: string,
    dto: AddGroupExpenseDto,
  ): Promise<PublicGroupExpense> {
    const group = await this.findOwnedGroup(userId, groupId);
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

    return this.toPublicExpense(expense);
  }

  async recordSettlement(
    userId: string,
    groupId: string,
    dto: RecordSettlementDto,
  ): Promise<PublicGroupExpense> {
    const group = await this.findOwnedGroup(userId, groupId);
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

    return this.toPublicExpense(expense);
  }

  async getBalances(userId: string, groupId: string): Promise<GroupBalances> {
    const group = await this.findOwnedGroup(userId, groupId);
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

  private async findOwnedGroup(userId: string, groupId: string): Promise<ExpenseGroupDocument> {
    const group = await this.groupModel.findById(groupId).exec();
    if (!group) throw new NotFoundException('Group not found');
    if (group.userId.toString() !== userId)
      throw new ForbiddenException('You do not own this group');
    return group;
  }

  private assemble(
    group: ExpenseGroupDocument,
    expenses: GroupExpenseDocument[],
  ): PublicExpenseGroup {
    return {
      id: group._id.toString(),
      name: group.name,
      category: group.category,
      members: group.members.map((m) => ({ id: m.id, name: m.name, phone: m.phone })),
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
      })),
      splitType: doc.splitType,
      notes: doc.notes,
      isSettlement: doc.isSettlement,
      settlementFrom: doc.settlementFrom,
      settlementTo: doc.settlementTo,
    };
  }
}
