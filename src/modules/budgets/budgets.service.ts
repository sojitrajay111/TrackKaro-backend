import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { CATEGORY_NAMES, CategoryName } from '@/common/constants/categories';
import { formatINR, toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import {
  Transaction,
  TransactionDocument,
} from '@/modules/transactions/schemas/transaction.schema';
import { CategoryBudget, CategoryBudgetDocument } from './schemas/category-budget.schema';

export interface PublicBudget {
  category: CategoryName;
  limit: number;
}

const OVER_BUDGET_RATIO = 1;
const NEAR_BUDGET_RATIO = 0.8;

@Injectable()
export class BudgetsService {
  constructor(
    @InjectModel(CategoryBudget.name) private readonly budgetModel: Model<CategoryBudgetDocument>,
    @InjectModel(Transaction.name) private readonly transactionModel: Model<TransactionDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async findAll(userId: string): Promise<PublicBudget[]> {
    const docs = await this.budgetModel.find({ userId }).exec();
    return docs.map((doc) => ({
      category: doc.category as CategoryName,
      limit: toMajorUnits(doc.limitMinor),
    }));
  }

  async upsert(userId: string, category: string, limitRupees: number): Promise<PublicBudget> {
    if (!CATEGORY_NAMES.includes(category as CategoryName)) {
      throw new BadRequestException(`Unknown category: ${category}`);
    }

    const doc = await this.budgetModel
      .findOneAndUpdate(
        { userId, category },
        { limitMinor: toMinorUnits(limitRupees) },
        { upsert: true, new: true },
      )
      .exec();

    return { category: doc.category as CategoryName, limit: toMajorUnits(doc.limitMinor) };
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.budgetModel.deleteMany({ userId }).exec();
  }

  /**
   * Mirrors the original client-side checkBudgetThreshold in app-store.tsx: sums this
   * category's existing expense transactions, adds the amount about to be recorded, and
   * fires a notification at 80% (near limit) or 100%+ (exceeded) of the budget.
   */
  async checkThreshold(userId: string, category: string, newAmountMinor: number): Promise<void> {
    const budget = await this.budgetModel.findOne({ userId, category }).exec();
    if (!budget || budget.limitMinor <= 0) return;

    const [agg] = await this.transactionModel.aggregate<{ total: number }>([
      { $match: { userId: new Types.ObjectId(userId), category, type: 'expense' } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]);
    const currentSpentMinor = agg?.total ?? 0;
    const totalSpentMinor = currentSpentMinor + newAmountMinor;
    const ratio = totalSpentMinor / budget.limitMinor;

    if (ratio >= OVER_BUDGET_RATIO) {
      await this.notificationsService.create(userId, {
        title: `🚨 ${category} Budget Exceeded!`,
        message: `You spent ${formatINR(toMajorUnits(totalSpentMinor))} of your ${formatINR(toMajorUnits(budget.limitMinor))} limit.`,
        type: 'insight',
      });
    } else if (ratio >= NEAR_BUDGET_RATIO) {
      await this.notificationsService.create(userId, {
        title: `⚠️ ${category} Budget Alert`,
        message: `${category} is at ${Math.round(ratio * 100)}% of limit (${formatINR(toMajorUnits(budget.limitMinor - totalSpentMinor))} left).`,
        type: 'insight',
      });
    }
  }
}
