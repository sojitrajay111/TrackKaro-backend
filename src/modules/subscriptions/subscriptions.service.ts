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
    return this.withComputedRedundancy(docs);
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

  /** Percentage growth in total monthly subscription cost driven by subscriptions added in the
   * last 30 days — real, timestamp-derived, and null (rather than a guess) when there's nothing
   * a month old yet to compare against. Doesn't capture cancellations, since removed
   * subscriptions are deleted rather than soft-flagged. */
  async getMonthlyChangePercent(userId: string): Promise<number | null> {
    const docs = await this.subscriptionModel.find({ userId }).exec();
    const monthlyEquivalent = (sub: SubscriptionDocument) =>
      sub.billingCycle === 'Yearly' ? sub.amountMinor / MONTHS_PER_YEAR : sub.amountMinor;

    const currentTotal = docs.reduce((acc, s) => acc + monthlyEquivalent(s), 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const previousTotal = docs
      .filter((s) => s.createdAt <= thirtyDaysAgo)
      .reduce((acc, s) => acc + monthlyEquivalent(s), 0);

    if (previousTotal <= 0) return null;
    return Math.round(((currentTotal - previousTotal) / previousTotal) * 100);
  }

  /** Monthly-equivalent spend saved if every redundant subscription were cancelled (rupees). */
  async sumRedundantMonthlyEquivalent(userId: string): Promise<number> {
    const docs = await this.subscriptionModel.find({ userId }).exec();
    const redundant = this.withComputedRedundancy(docs).filter((s) => s.isRedundant);
    const minor = redundant.reduce(
      (acc, sub) =>
        acc + (sub.billingCycle === 'Yearly' ? sub.annualCost / MONTHS_PER_YEAR : sub.amount),
      0,
    );
    return Math.round(minor);
  }

  /** Flags overlapping subscriptions within the same category — real detection based on the
   * user's own data, rather than trusting a client-supplied flag at creation time. Within each
   * category with more than one active subscription, every one except the cheapest is flagged. */
  private withComputedRedundancy(docs: SubscriptionDocument[]): PublicSubscription[] {
    const byCategory = new Map<string, SubscriptionDocument[]>();
    for (const doc of docs) {
      const key = doc.category.toLowerCase().trim();
      const group = byCategory.get(key) ?? [];
      group.push(doc);
      byCategory.set(key, group);
    }

    const redundantIds = new Set<string>();
    for (const group of byCategory.values()) {
      if (group.length < 2) continue;
      const cheapest = group.reduce((min, s) => (s.amountMinor < min.amountMinor ? s : min));
      for (const sub of group) {
        if (sub._id.toString() !== cheapest._id.toString()) {
          redundantIds.add(sub._id.toString());
        }
      }
    }

    return docs.map((doc) =>
      this.toPublic(doc, { isRedundant: redundantIds.has(doc._id.toString()) }),
    );
  }

  private toPublic(
    doc: SubscriptionDocument,
    computed?: { isRedundant: boolean; redundancyReason?: string },
  ): PublicSubscription {
    return {
      id: doc._id.toString(),
      name: doc.name,
      category: doc.category,
      amount: toMajorUnits(doc.amountMinor),
      billingCycle: doc.billingCycle,
      nextBillingDate: doc.nextBillingDate,
      annualCost: toMajorUnits(doc.annualCostMinor),
      icon: doc.icon,
      isRedundant: computed?.isRedundant ?? doc.isRedundant,
      redundancyReason: computed?.redundancyReason ?? doc.redundancyReason,
    };
  }
}
