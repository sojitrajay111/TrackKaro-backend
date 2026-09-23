import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { MerchantOffer, MerchantOfferDocument } from '../schemas/merchant-offer.schema';
import {
  DealSearchLog,
  DealSearchLogDocument,
  DealSearchStatus,
} from '../schemas/deal-search-log.schema';

/** How long a provider's search result is considered fresh enough to reuse without calling the
 * provider again. Deliberately coarse (not per-category) — revisit once real Flipkart traffic
 * patterns and rate limits are known. */
export const OFFER_STALE_AFTER_MS = 1000 * 60 * 60 * 6; // 6 hours

/**
 * Provider-neutral freshness/caching policy. Lets `MarketplaceDealsService` skip an external
 * provider call for a search it already has a recent, successful result for, and gives every
 * returned deal a clear "is this actually current" signal instead of silently presenting an old
 * price as today's price.
 */
@Injectable()
export class DealCacheService {
  constructor(
    @InjectModel(DealSearchLog.name) private readonly searchLogModel: Model<DealSearchLogDocument>,
    @InjectModel(MerchantOffer.name) private readonly offerModel: Model<MerchantOfferDocument>,
  ) {}

  normalizeQuery(query?: string): string {
    return (query || 'all').trim().toLowerCase();
  }

  isStale(observedAt: Date, now: Date = new Date()): boolean {
    return now.getTime() - observedAt.getTime() > OFFER_STALE_AFTER_MS;
  }

  /** Returns still-fresh offers for this provider+query if a successful search was logged
   * recently enough — the caller can skip re-hitting the provider entirely. Returns null on a
   * cache miss (no recent successful log, or no offers survive the freshness window). */
  async getFreshCachedOffers(
    providerId: string,
    query: string | undefined,
  ): Promise<MerchantOfferDocument[] | null> {
    const normalizedQuery = this.normalizeQuery(query);
    const cutoff = new Date(Date.now() - OFFER_STALE_AFTER_MS);

    const recentLog = await this.searchLogModel
      .findOne({ providerId, normalizedQuery, status: 'success', observedAt: { $gte: cutoff } })
      .sort({ observedAt: -1 })
      .exec();
    if (!recentLog) return null;

    const offers = await this.offerModel
      .find({ providerId, observedAt: { $gte: cutoff } })
      .sort({ observedAt: -1 })
      .limit(50)
      .exec();
    return offers.length > 0 ? offers : null;
  }

  async logSearch(
    providerId: string,
    query: string | undefined,
    status: DealSearchStatus,
    resultCount: number,
    message?: string,
  ): Promise<void> {
    await this.searchLogModel.create({
      providerId,
      normalizedQuery: this.normalizeQuery(query),
      status,
      resultCount,
      message,
      observedAt: new Date(),
    });
  }
}
