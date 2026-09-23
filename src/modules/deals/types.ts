/**
 * Shapes shared between the deals engine (`deals.service.ts`) and every provider
 * (`providers/*`). Lives outside `deals.service.ts` so providers can import these types
 * without creating a circular dependency on the service that orchestrates them.
 */

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
  dealUrl?: string;
  sourceUrl?: string;
  sourceType?: string;
  verifiedAt?: string;
  lastCheckedAt?: string;
  priceVerified?: boolean;
  urlVerified?: boolean;
  offerConditions?: string[];
  aiReason?: string;
  purchaseCheck?: {
    status: 'SAFE' | 'WAIT';
    reason: string;
  };
  dealScore?: number;
  relevanceScore?: number;
  confidence?: number;
}

export interface UserFinancialProfile {
  currentBalance: number;
  upcomingBills: number;
  safeSpendingLimit: number;
  topCategories: { category: string; spent: number }[];
  budgetMap: Map<string, { limit: number; spent: number; remaining: number }>;
}

/** `'provider'` is the target production path (real marketplace data only). `'legacy'` is the
 * pre-existing Gemini-generated deal finder, kept only for side-by-side comparison during the
 * Flipkart integration rollout — see providers/gemini-legacy.provider.ts. */
export type DealsEngineMode = 'provider' | 'legacy';
