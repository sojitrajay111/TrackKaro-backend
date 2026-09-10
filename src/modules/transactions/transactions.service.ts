import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';

import { toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { BudgetsService } from '@/modules/budgets/budgets.service';
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
  ) {}

  async create(userId: string, dto: CreateTransactionDto): Promise<PublicTransaction> {
    const amountMinor = toMinorUnits(dto.amount);

    // Threshold must be checked against spend *before* this transaction exists — checkThreshold
    // sums all persisted expenses in the category and adds `amountMinor` itself, so creating
    // the transaction first would double-count it.
    if (dto.type === 'expense') {
      await this.budgetsService.checkThreshold(userId, dto.category, amountMinor);
    }

    const doc = await this.transactionModel.create({
      userId,
      title: dto.title,
      merchant: dto.merchant,
      amountMinor,
      type: dto.type,
      category: dto.category,
      date: dto.date,
      paymentMethod: dto.paymentMethod,
      people: dto.people,
      notes: dto.notes,
    });

    return this.toPublic(doc);
  }

  async findAll(userId: string, query: QueryTransactionsDto): Promise<PaginatedTransactions> {
    const filter: FilterQuery<TransactionDocument> = { userId };
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
    const doc = await this.transactionModel.findOne({ _id: id, userId }).exec();
    if (!doc) throw new NotFoundException('Transaction not found');
    return this.toPublic(doc);
  }

  async update(userId: string, id: string, dto: UpdateTransactionDto): Promise<PublicTransaction> {
    const patch: Record<string, unknown> = { ...dto };
    if (dto.amount !== undefined) {
      patch.amountMinor = toMinorUnits(dto.amount);
      delete patch.amount;
    }

    const doc = await this.transactionModel
      .findOneAndUpdate({ _id: id, userId }, patch, { new: true })
      .exec();
    if (!doc) throw new NotFoundException('Transaction not found');
    return this.toPublic(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.transactionModel.deleteOne({ _id: id, userId }).exec();
    if (result.deletedCount === 0) throw new NotFoundException('Transaction not found');
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.transactionModel.deleteMany({ userId }).exec();
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
      people: doc.people,
      notes: doc.notes,
    };
  }
}
