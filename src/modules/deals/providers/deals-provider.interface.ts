import { UserFinancialProfile } from '../types';

/**
 * A single normalized deal as returned by a provider, BEFORE TrackKaro's own scoring/persistence
 * layer touches it. Every field here must trace back to the provider's own source (a marketplace
 * API/feed, or — for the legacy provider only — an LLM response); nothing in this shape is
 * computed by TrackKaro itself. See `deals.service.ts#rankAndPersistProviderDeals` for what
 * TrackKaro adds on top (purchase-safety check, multi-factor ranking, category mapping).
 */
export interface ProviderDealResult {
  /** The provider's own stable listing/product id, when it has one. Lets `DealIngestionService`
   * upsert idempotently instead of re-matching by URL on every refresh. The legacy Gemini
   * provider never sets this (free-text sources have no stable id to give). */
  providerProductId?: string;
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
  expiryDate?: string;
  rating?: number;
  imageUrl?: string;
  /** Direct product/offer URL. Required — a deal with no real link back to the source is not
   * actionable and must not be surfaced (see the provider's own validation before returning). */
  dealUrl: string;
  sourceUrl?: string;
  offerConditions?: string[];
  bestReason?: string;
  /** Whether the provider itself is asserting this price/link as currently accurate. Real
   * marketplace-API providers should set these `true` only when the API response says so;
   * the legacy AI provider sets them to match its pre-existing (unverified) behavior. */
  priceVerified?: boolean;
  urlVerified?: boolean;
  /** 0–1 confidence the provider has in this result being accurate right now. */
  confidence?: number;
}

export type DealsProviderStatus = 'ok' | 'unavailable' | 'error';

export interface DealsSearchResult {
  status: DealsProviderStatus;
  deals: ProviderDealResult[];
  /** Human-readable reason for 'unavailable'/'error' — surfaced in logs, and safe to show to
   * developers/users as "why is this empty" context. Never used to fabricate a deal. */
  message?: string;
}

export interface DealsProviderContext {
  userId: string;
  query?: string;
  profile: UserFinancialProfile;
}

/**
 * A source of real deal data. Implement this once per marketplace (Flipkart, Amazon, Myntra, …)
 * and register it in `deals.module.ts` — `deals.service.ts` never needs to change to support a
 * new provider.
 */
export interface DealsProvider {
  /** Stable id, also stamped onto persisted deals as `sourceType` for traceability. */
  readonly id: string;
  readonly displayName: string;
  /** Whether this provider has everything it needs (API keys, etc.) to be called at all. A
   * provider that isn't configured is skipped, never called with partial/missing credentials. */
  isConfigured(): boolean;
  search(context: DealsProviderContext): Promise<DealsSearchResult>;
}
