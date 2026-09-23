import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { MerchantOffer, MerchantOfferDocument } from '../schemas/merchant-offer.schema';
import { PriceHistory, PriceHistoryDocument } from '../schemas/price-history.schema';

export interface PriceHistoryComparison {
  lowestObservedMinor: number | null;
  isAllTimeLow: boolean;
  sampleCount: number;
}

/**
 * Derived deal calculations — everything a provider itself must never compute. A provider
 * supplies facts (price, coupon text, URL, …); this service is the only place TrackKaro turns
 * those facts into a discount %, an effective price, a price-history comparison, or a ranking
 * score. Never invents a fact — only computes from facts already on the offer/history.
 */
@Injectable()
export class DealEngineService {
  constructor(
    @InjectModel(PriceHistory.name) private readonly priceHistoryModel: Model<PriceHistoryDocument>,
    @InjectModel(MerchantOffer.name) private readonly offerModel: Model<MerchantOfferDocument>,
  ) {}

  computeDiscountPercent(originalMinor: number, finalMinor: number): number {
    if (originalMinor <= 0) return 0;
    return Math.min(
      99,
      Math.max(0, Math.round(((originalMinor - finalMinor) / originalMinor) * 100)),
    );
  }

  /**
   * "Effective" (coupon/cashback-adjusted) price. Coupon/cashback are currently free-text
   * (`couponCode`, `cashbackText`) with no structured, verified numeric amount attached by any
   * provider yet — so there is nothing safe to subtract without guessing. This returns the
   * offer's already-known final price unchanged, and is the single seam a future provider's
   * *verified, numeric* coupon/cashback amount would plug into — never parse a discount amount
   * out of free text here.
   */
  computeEffectivePriceMinor(offer: { finalPriceMinor: number }): number {
    return offer.finalPriceMinor;
  }

  /**
   * Compares a current price against this offer's own recorded history. Only ever reports
   * "all-time low" when there's more than one historical observation to compare against — a
   * single data point (the price just observed) proves nothing about history.
   */
  async priceHistoryComparison(
    merchantOfferId: Types.ObjectId,
    currentFinalMinor: number,
  ): Promise<PriceHistoryComparison> {
    const [lowest, sampleCount] = await Promise.all([
      this.priceHistoryModel
        .findOne({ merchantOfferId })
        .sort({ finalPriceMinor: 1 })
        .select('finalPriceMinor')
        .exec(),
      this.priceHistoryModel.countDocuments({ merchantOfferId }).exec(),
    ]);

    if (!lowest) {
      return { lowestObservedMinor: null, isAllTimeLow: false, sampleCount };
    }

    const isAllTimeLow = sampleCount > 1 && currentFinalMinor <= lowest.finalPriceMinor;
    return { lowestObservedMinor: lowest.finalPriceMinor, isAllTimeLow, sampleCount };
  }

  /** Cross-merchant comparison for the same canonical product — the cheapest currently-known
   * final price for this product from any OTHER provider's offer for it, so a deal can be
   * compared against its competitors. Returns null until a second provider is actually
   * ingesting offers for the same product (today, only Flipkart is even a candidate, and it's
   * unconfigured, so this has nothing to compare against yet). */
  async cheapestCompetingOfferMinor(
    productId: Types.ObjectId,
    excludingOfferId: Types.ObjectId,
  ): Promise<number | null> {
    const cheapest = await this.offerModel
      .findOne({ productId, _id: { $ne: excludingOfferId } })
      .sort({ finalPriceMinor: 1 })
      .select('finalPriceMinor')
      .exec();
    return cheapest ? cheapest.finalPriceMinor : null;
  }

  /** Multi-factor deal score. Provider-neutral and independent of any one user's spending
   * profile — deliberately simpler than the legacy engine's user-relevance-weighted score
   * (`DealsService.calculateMultiFactorRank`), since this one only has verified marketplace
   * facts to work with, by design. */
  computeScore(offer: {
    discountPercent: number;
    priceVerified?: boolean;
    urlVerified?: boolean;
    couponCode?: string;
    rating?: number;
  }): number {
    let score = Math.min(35, offer.discountPercent);
    if (offer.priceVerified) score += 20;
    if (offer.urlVerified) score += 15;
    if (offer.couponCode) score += 10;
    if (offer.rating) score += Math.min(10, offer.rating * 2);
    return score;
  }
}
