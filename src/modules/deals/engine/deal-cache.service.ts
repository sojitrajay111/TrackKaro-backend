import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

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

    // If exact offerIds were linked to this query, load only those exact offers and maintain order
    if (recentLog.offerIds && recentLog.offerIds.length > 0) {
      const offers = await this.offerModel
        .find({ _id: { $in: recentLog.offerIds }, observedAt: { $gte: cutoff } })
        .exec();
      if (offers.length > 0) {
        const idMap = new Map(offers.map((o) => [o._id.toString(), o]));
        const sorted = recentLog.offerIds
          .map((id) => idMap.get(id.toString()))
          .filter((o): o is (typeof offers)[number] => o !== undefined);
        if (sorted.length > 0) return sorted;
        return offers;
      }
    }

    const filter: Record<string, unknown> = {
      providerId,
      observedAt: { $gte: cutoff },
    };

    let words: string[] = [];
    if (query && query.trim().toLowerCase() !== 'all') {
      const q = query.trim().toLowerCase();
      words = q
        .replace(/([a-zA-Z]+)(\d+)/g, '$1 $2')
        .split(/[^a-zA-Z0-9]+/)
        .filter((w) => w.length >= 2);

      if (words.length > 0) {
        // Only return cached offers whose title actually matches the search query terms
        const regexes = words.map(
          (w) => new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        );
        filter.$or = regexes.map((r) => ({ title: { $regex: r } }));
      }
    }

    const offers = await this.offerModel
      .find(filter)
      .sort({ observedAt: -1 })
      .limit(50)
      .exec();

    if (words.length > 0 && offers.length > 0) {
      offers.sort((a, b) => {
        const aTitle = a.title.toLowerCase();
        const bTitle = b.title.toLowerCase();
        const aMatches = words.reduce((acc, t) => acc + (aTitle.includes(t) ? 1 : 0), 0);
        const bMatches = words.reduce((acc, t) => acc + (bTitle.includes(t) ? 1 : 0), 0);
        return bMatches - aMatches;
      });
    }

    return offers.length > 0 ? offers : null;
  }

  async logSearch(
    providerId: string,
    query: string | undefined,
    status: DealSearchStatus,
    resultCount: number,
    message?: string,
    offerIds?: Types.ObjectId[],
  ): Promise<void> {
    await this.searchLogModel.create({
      providerId,
      normalizedQuery: this.normalizeQuery(query),
      status,
      resultCount,
      message,
      offerIds: offerIds ?? [],
      observedAt: new Date(),
    });
  }
}
