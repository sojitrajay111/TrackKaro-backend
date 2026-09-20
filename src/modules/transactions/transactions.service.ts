import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { BudgetsService } from '@/modules/budgets/budgets.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { QueryTransactionsDto } from './dto/query-transactions.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { Transaction, TransactionDocument } from './schemas/transaction.schema';

export interface PublicTransaction {
  id: string;
  title: string;
  merchant: string;
  amount: number;
  type: Transaction['type'];
  category: string;
  date: string;
  paymentMethod: Transaction['paymentMethod'];
  scope?: string;
  people?: string[];
  notes?: string;
}

export interface PaginatedTransactions {
  items: PublicTransaction[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class TransactionsService {
  constructor(
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    private readonly budgetsService: BudgetsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(userId: string, dto: CreateTransactionDto): Promise<PublicTransaction> {
    if (!userId) {
      throw new UnauthorizedException('User authentication required');
    }
    const amountMinor = toMinorUnits(dto.amount);

    // Threshold must be checked against spend *before* this transaction exists — checkThreshold
    // sums all persisted expenses in the category and adds `amountMinor` itself, so creating
    // the transaction first would double-count it.
    if (dto.type === 'expense') {
      void this.budgetsService.checkThreshold(userId, dto.category, amountMinor).catch(() => {
        // Non-blocking background threshold check
      });
    }

    const doc = await this.transactionModel.create({
      userId: new Types.ObjectId(userId),
      title: dto.title,
      merchant: dto.merchant,
      amountMinor,
      type: dto.type,
      category: dto.category,
      date: dto.date,
      paymentMethod: dto.paymentMethod,
      scope: dto.scope || 'Personal',
      people: dto.people,
      notes: dto.notes,
    });

    void this.notificationsService.create(userId, {
      title: doc.type === 'income' ? 'Income Added' : 'Expense Added',
      message: `${doc.type === 'income' ? 'Received' : 'Spent'} ₹${toMajorUnits(doc.amountMinor)} for "${doc.title}"`,
      type: 'activity',
    }).catch(() => {});

    return this.toPublic(doc);
  }

  async findAll(userId: string, query: QueryTransactionsDto): Promise<PaginatedTransactions> {
    if (!userId) {
      throw new UnauthorizedException('User authentication required');
    }
    const filter: FilterQuery<TransactionDocument> = { userId: new Types.ObjectId(userId) };
    if (query.category) filter.category = query.category;
    if (query.type) filter.type = query.type;
    if (query.from || query.to) {
      filter.date = {};
      if (query.from) filter.date.$gte = query.from;
      if (query.to) filter.date.$lte = query.to;
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const [docs, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.transactionModel.countDocuments(filter).exec(),
    ]);

    return { items: docs.map((doc) => this.toPublic(doc)), total, page, limit };
  }

  async findOne(userId: string, id: string): Promise<PublicTransaction> {
    if (!userId) {
      throw new UnauthorizedException('User authentication required');
    }
    const doc = await this.transactionModel
      .findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) })
      .exec();
    if (!doc) throw new NotFoundException('Transaction not found');
    return this.toPublic(doc);
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto): Promise<PublicTransaction> {
    if (!userId) {
      throw new UnauthorizedException('User authentication required');
    }
    const patch: Record<string, unknown> = { ...dto };
    if (dto.amount !== undefined) {
      patch.amountMinor = toMinorUnits(dto.amount);
      delete patch.amount;
    }

    const doc = await this.transactionModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) },
        patch,
        { new: true },
      )
      .exec();
    if (!doc) throw new NotFoundException('Transaction not found');

    void this.notificationsService.create(userId, {
      title: 'Expense Updated',
      message: `Updated "${doc.title}" (₹${toMajorUnits(doc.amountMinor)})`,
      type: 'activity',
    }).catch(() => {});

    return this.toPublic(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    if (!userId) {
      throw new UnauthorizedException('User authentication required');
    }
    const doc = await this.transactionModel.findOne({ _id: new Types.ObjectId(id), userId: new Types.ObjectId(userId) }).exec();
    if (!doc) throw new NotFoundException('Transaction not found');

    const title = doc.title;
    await doc.deleteOne();

    void this.notificationsService.create(userId, {
      title: 'Expense Deleted',
      message: `Deleted "${title}"`,
      type: 'activity',
    }).catch(() => {});
  }

  async deleteAllForUser(userId: string): Promise<void> {
    if (!userId) {
      throw new UnauthorizedException('User authentication required');
    }
    await this.transactionModel.deleteMany({ userId: new Types.ObjectId(userId) }).exec();
  }

  private toPublic(doc: TransactionDocument): PublicTransaction {
    return {
      id: doc._id.toString(),
      title: doc.title,
      merchant: doc.merchant,
      amount: toMajorUnits(doc.amountMinor),
      type: doc.type,
      category: doc.category,
      date: doc.date,
      paymentMethod: doc.paymentMethod,
      scope: (doc as any).scope || 'Personal',
      people: doc.people,
      notes: doc.notes,
    };
  }
}
