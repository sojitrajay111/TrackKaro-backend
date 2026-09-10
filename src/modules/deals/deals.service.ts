import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { formatINR, toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { DEAL_SEED } from './deals.seed';
import { Deal, DealDocument } from './schemas/deal.schema';

export interface PublicDeal {
  id: string;
  title: string;
  platform: string;
  category: string;
  originalPrice: number;
  currentPrice: number;
  discountPercent: number;
  couponCode?: string;
  cashbackText?: string;
  deliveryCharge: number;
  finalPrice: number;
  savingsAmount: number;
  expiryDate: string;
  bestReason: string;
  rating?: number;
  imageUrl?: string;
  tracked?: boolean;
  targetPrice?: number;
}

@Injectable()
export class DealsService {
  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async seedDefaultDeals(userId: string): Promise<void> {
    await this.dealModel.insertMany(
      DEAL_SEED.map((d) => ({
        userId,
        title: d.title,
        platform: d.platform,
        category: d.category,
        originalPriceMinor: toMinorUnits(d.originalPrice),
        currentPriceMinor: toMinorUnits(d.currentPrice),
        discountPercent: d.discountPercent,
        couponCode: d.couponCode,
        cashbackText: d.cashbackText,
        deliveryChargeMinor: toMinorUnits(d.deliveryCharge),
        finalPriceMinor: toMinorUnits(d.finalPrice),
        savingsAmountMinor: toMinorUnits(d.savingsAmount),
        expiryDate: d.expiryDate,
        bestReason: d.bestReason,
        rating: d.rating,
        imageUrl: d.imageUrl,
        tracked: d.tracked,
        targetPriceMinor: d.targetPrice !== undefined ? toMinorUnits(d.targetPrice) : undefined,
      })),
    );
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.dealModel.deleteMany({ userId }).exec();
  }

  async findAll(userId: string): Promise<PublicDeal[]> {
    const docs = await this.dealModel.find({ userId }).exec();
    return docs.map((doc) => this.toPublic(doc));
  }

  async toggleTrack(userId: string, id: string, targetPrice?: number): Promise<PublicDeal> {
    const deal = await this.dealModel.findOne({ _id: id, userId }).exec();
    if (!deal) throw new NotFoundException('Deal not found');

    deal.tracked = !deal.tracked;
    deal.targetPriceMinor =
      targetPrice !== undefined ? toMinorUnits(targetPrice) : deal.currentPriceMinor;
    await deal.save();
    return this.toPublic(deal);
  }

  /**
   * User-triggered demo of what a price-drop alert looks like — the app has no live price
   * feed, so this manually overrides the deal's price fields exactly like the "Simulate Price
   * Drop Now" button always did client-side. It's explicitly labeled as a simulation in the
   * UI, so making it a real (if fake-data) mutation here doesn't misrepresent anything.
   */
  async simulateDrop(userId: string, id: string, targetPrice?: number): Promise<PublicDeal> {
    const deal = await this.dealModel.findOne({ _id: id, userId }).exec();
    if (!deal) throw new NotFoundException('Deal not found');

    const targetMinor =
      targetPrice !== undefined
        ? toMinorUnits(targetPrice)
        : (deal.targetPriceMinor ?? Math.round(deal.currentPriceMinor * 0.85));

    const newFinalMinor = Math.max(
      0,
      targetMinor -
        Math.round((targetMinor * deal.discountPercent) / 100) +
        deal.deliveryChargeMinor,
    );

    deal.currentPriceMinor = targetMinor;
    deal.finalPriceMinor = newFinalMinor;
    deal.savingsAmountMinor = deal.originalPriceMinor - newFinalMinor;
    deal.tracked = true;
    deal.targetPriceMinor = targetMinor;
    await deal.save();

    await this.notificationsService.create(userId, {
      title: `🔔 Price Drop: ${deal.platform}`,
      message: `${deal.title} dropped to ${formatINR(toMajorUnits(newFinalMinor))}! Below your target price.`,
      type: 'price_drop',
    });

    return this.toPublic(deal);
  }

  private toPublic(doc: DealDocument): PublicDeal {
    return {
      id: doc._id.toString(),
      title: doc.title,
      platform: doc.platform,
      category: doc.category,
      originalPrice: toMajorUnits(doc.originalPriceMinor),
      currentPrice: toMajorUnits(doc.currentPriceMinor),
      discountPercent: doc.discountPercent,
      couponCode: doc.couponCode,
      cashbackText: doc.cashbackText,
      deliveryCharge: toMajorUnits(doc.deliveryChargeMinor),
      finalPrice: toMajorUnits(doc.finalPriceMinor),
      savingsAmount: toMajorUnits(doc.savingsAmountMinor),
      expiryDate: doc.expiryDate,
      bestReason: doc.bestReason,
      rating: doc.rating,
      imageUrl: doc.imageUrl,
      tracked: doc.tracked,
      targetPrice:
        doc.targetPriceMinor !== undefined ? toMajorUnits(doc.targetPriceMinor) : undefined,
    };
  }
}
