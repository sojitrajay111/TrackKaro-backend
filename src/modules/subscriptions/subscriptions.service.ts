import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { Subscription, SubscriptionDocument } from './schemas/subscription.schema';

export interface PublicSubscription {
  id: string;
  name: string;
  category: string;
  amount: number;
  billingCycle: Subscription['billingCycle'];
  nextBillingDate: string;
  annualCost: number;
  icon: string;
  isRedundant?: boolean;
  redundancyReason?: string;
}

const MONTHS_PER_YEAR = 12;

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectModel(Subscription.name) private readonly subscriptionModel: Model<SubscriptionDocument>,
  ) {}

  async findAll(userId: string): Promise<PublicSubscription[]> {
    const docs = await this.subscriptionModel.find({ userId }).sort({ nextBillingDate: 1 }).exec();
    return docs.map((doc) => this.toPublic(doc));
  }

  async create(userId: string, dto: CreateSubscriptionDto): Promise<PublicSubscription> {
    const amountMinor = toMinorUnits(dto.amount);
    const annualCostMinor =
      dto.billingCycle === 'Monthly' ? amountMinor * MONTHS_PER_YEAR : amountMinor;

    const doc = await this.subscriptionModel.create({
      userId,
      name: dto.name,
      category: dto.category,
      amountMinor,
      billingCycle: dto.billingCycle,
      nextBillingDate: dto.nextBillingDate,
      annualCostMinor,
      icon: dto.icon,
      isRedundant: dto.isRedundant,
      redundancyReason: dto.redundancyReason,
    });
    return this.toPublic(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.subscriptionModel.deleteOne({ _id: id, userId }).exec();
    if (result.deletedCount === 0) throw new NotFoundException('Subscription not found');
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.subscriptionModel.deleteMany({ userId }).exec();
  }

  /** Monthly-equivalent spend saved if every redundant subscription were cancelled (rupees). */
  async sumRedundantMonthlyEquivalent(userId: string): Promise<number> {
    const redundant = await this.subscriptionModel.find({ userId, isRedundant: true }).exec();
    const minor = redundant.reduce(
      (acc, sub) =>
        acc + (sub.billingCycle === 'Yearly' ? sub.amountMinor / MONTHS_PER_YEAR : sub.amountMinor),
      0,
    );
    return toMajorUnits(minor);
  }

  private toPublic(doc: SubscriptionDocument): PublicSubscription {
    return {
      id: doc._id.toString(),
      name: doc.name,
      category: doc.category,
      amount: toMajorUnits(doc.amountMinor),
      billingCycle: doc.billingCycle,
      nextBillingDate: doc.nextBillingDate,
      annualCost: toMajorUnits(doc.annualCostMinor),
      icon: doc.icon,
      isRedundant: doc.isRedundant,
      redundancyReason: doc.redundancyReason,
    };
  }
}
