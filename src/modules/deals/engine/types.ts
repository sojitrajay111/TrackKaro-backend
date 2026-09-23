export type DealResponseStatus = 'success' | 'unavailable' | 'error';

/**
 * One deal as returned by `GET /deals/search`, regardless of engine. Superset-compatible with
 * the older `PublicDeal` shape (same core price/title/url fields) so the existing frontend deal
 * card can render it without a rewrite, plus new fields (`offerId`, `stale`, `isAllTimeLow`, …)
 * that a caller can simply ignore until it's ready to use them.
 */
export interface PublicMerchantDeal {
  offerId: string;
  productId: string;
  title: string;
  platform: string;
  category: string;
  brand?: string;
  originalPrice: number;
  currentPrice: number;
  discountPercent: number;
  couponCode?: string;
  cashbackText?: string;
  deliveryCharge: number;
  finalPrice: number;
  savingsAmount: number;
  rating?: number;
  imageUrl?: string;
  dealUrl: string;
  /** `DealsProvider.id` this deal actually came from (e.g. 'flipkart', or 'gemini-legacy'). */
  sourceType: string;
  priceVerified: boolean;
  urlVerified: boolean;
  /** ISO timestamp of when this price was last actually confirmed. */
  observedAt: string;
  /** True once `observedAt` is older than the staleness policy — see `DealCacheService`. Never
   * silently hidden; a stale deal is still returned, just flagged. */
  stale: boolean;
  /** Only ever true when real price history has more than one observation to compare against —
   * see `DealEngineService#priceHistoryComparison`. */
  isAllTimeLow: boolean;
  lowestObservedPrice: number | null;
  dealScore: number;
  /** Whether the current user has an active `DealAlert` on this offer. */
  alerted: boolean;
  targetPrice?: number;
}

export interface DealSearchResponse {
  status: DealResponseStatus;
  engine: 'provider' | 'legacy';
  /** Present on 'unavailable'/'error' (why), and optionally on 'success' (e.g. a cache note). */
  message?: string;
  deals: PublicMerchantDeal[];
}
