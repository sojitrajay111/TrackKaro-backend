import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { formatINR } from '@/common/money/money.util';
import { AppConfig } from '@/config/configuration';
import { UserFinancialProfile } from '../types';
import {
  DealsProvider,
  DealsProviderContext,
  DealsSearchResult,
  ProviderDealResult,
} from './deals-provider.interface';
import { getPlatformSearchUrl } from './platform-links.util';

/**
 * LEGACY / COMPARISON ONLY — not the production path.
 *
 * This is the pre-existing Gemini-generated deal finder, moved here unchanged in behavior so it
 * can keep running side-by-side with the new provider architecture for comparison during the
 * Flipkart rollout. It asks an LLM (optionally grounded with Google Search) to *describe* deals
 * it believes exist, which is exactly what the new architecture's core rule forbids for the
 * production path: it can fabricate products, prices or links that don't actually exist.
 *
 * Only ever invoked when `DEALS_ENGINE_MODE=legacy` (or the equivalent per-request override) —
 * see `deals.service.ts`. Do not add this provider to `DealsProviderRegistry` / `DEALS_PROVIDERS`;
 * it is intentionally excluded from the "real provider" list the production path iterates.
 */
@Injectable()
export class GeminiLegacyDealsProvider implements DealsProvider {
  readonly id = 'gemini-legacy';
  readonly displayName = 'Gemini (legacy AI search — comparison only)';

  private readonly logger = new Logger(GeminiLegacyDealsProvider.name);

  constructor(private readonly configService: ConfigService<AppConfig>) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY);
  }

  async search(context: DealsProviderContext): Promise<DealsSearchResult> {
    const geminiKey = this.configService.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return { status: 'unavailable', deals: [], message: 'GEMINI_API_KEY is not configured.' };
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const expiryMinStr = new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0];

    try {
      const grounded = await this.searchGrounded(
        context.query,
        geminiKey,
        todayStr,
        expiryMinStr,
        context.profile,
      );
      if (grounded && grounded.length > 0) {
        this.logger.log(`Retrieved ${grounded.length} Google Search-grounded live deals.`);
        return { status: 'ok', deals: grounded };
      }

      const standard = await this.searchStandard(
        context.query,
        geminiKey,
        todayStr,
        expiryMinStr,
        context.profile,
      );
      if (standard.length > 0) {
        return { status: 'ok', deals: standard };
      }

      return { status: 'unavailable', deals: [], message: 'Gemini returned no usable deals.' };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Gemini legacy provider failed: ${message}`);
      return { status: 'error', deals: [], message };
    }
  }

  /** Maps Gemini's free-text category guess onto TrackKaro's canonical deal-category taxonomy. */
  private normalizeCategory(cat: string): string {
    const lower = String(cat || '').toLowerCase();
    if (
      lower.includes('elect') ||
      lower.includes('gadget') ||
      lower.includes('phone') ||
      lower.includes('laptop')
    )
      return 'Electronics';
    if (
      lower.includes('fash') ||
      lower.includes('cloth') ||
      lower.includes('shoe') ||
      lower.includes('wear')
    )
      return 'Fashion';
    if (
      lower.includes('food') ||
      lower.includes('dine') ||
      lower.includes('restaurant') ||
      lower.includes('meal')
    )
      return 'Food';
    if (lower.includes('beaut') || lower.includes('skin') || lower.includes('cosmetic'))
      return 'Beauty';
    if (
      lower.includes('travel') ||
      lower.includes('flight') ||
      lower.includes('hotel') ||
      lower.includes('trip')
    )
      return 'Travel';
    if (
      lower.includes('home') ||
      lower.includes('kitchen') ||
      lower.includes('appliance') ||
      lower.includes('bed')
    )
      return 'Home';
    return 'Shopping';
  }

  /** Validates + numerically coerces one raw Gemini JSON object into a ProviderDealResult, or
   * returns null if it doesn't look like a real, usable deal. */
  private toProviderDeal(d: any, expiryMinStr: string): ProviderDealResult | null {
    const title = String(d?.title || '').trim();
    const platform = String(d?.platform || '').trim();
    const finalGuess = Number(d?.finalPrice || d?.currentPrice || d?.originalPrice) || 0;
    if (!title || title.length <= 3 || !platform || platform.length <= 2 || finalGuess <= 100) {
      return null;
    }

    const category = this.normalizeCategory(d.category);
    const orig = Math.max(1, Number(d.originalPrice) || Number(d.currentPrice) || 1000);
    const curr = Math.max(1, Number(d.currentPrice) || orig);
    const fin = Math.max(1, Number(d.finalPrice) || curr);
    const sav = Math.max(0, orig - fin);
    const disc = Math.min(
      99,
      Math.max(0, Math.round(Number(d.discountPercent) || (sav / orig) * 100)),
    );
    const dealUrl =
      d.dealUrl && String(d.dealUrl).startsWith('http')
        ? String(d.dealUrl).trim()
        : getPlatformSearchUrl(platform, title);

    return {
      title,
      platform,
      category,
      originalPrice: orig,
      currentPrice: curr,
      discountPercent: disc,
      couponCode: d.couponCode ? String(d.couponCode).trim() : undefined,
      cashbackText: d.cashbackText ? String(d.cashbackText).trim() : undefined,
      deliveryCharge: Number(d.deliveryCharge) || 0,
      finalPrice: fin,
      savingsAmount: sav,
      expiryDate: d.expiryDate || expiryMinStr,
      rating: Number(d.rating) || 4.5,
      imageUrl: d.imageUrl || undefined,
      dealUrl,
      sourceUrl: d.sourceUrl ? String(d.sourceUrl).trim() : dealUrl,
      offerConditions: Array.isArray(d.offerConditions) ? d.offerConditions : [],
      bestReason: d.bestReason ? String(d.bestReason).trim() : undefined,
      // Preserves this provider's pre-existing (unverified) behavior exactly — it always
      // claimed these as true regardless of whether the underlying LLM response was accurate.
      priceVerified: true,
      urlVerified: true,
      confidence: 1,
    };
  }

  /** Google Search-grounded Gemini call — extracts live real-time retail deals from the web. */
  private async searchGrounded(
    query: string | undefined,
    geminiKey: string,
    todayStr: string,
    expiryMinStr: string,
    profile: UserFinancialProfile,
  ): Promise<ProviderDealResult[] | null> {
    const topCatString =
      profile.topCategories.length > 0
        ? profile.topCategories.map((c) => `${c.category} (₹${formatINR(c.spent)})`).join(', ')
        : 'Food, Shopping, Groceries';

    const prompt =
      query && query !== 'All'
        ? `Search live Indian e-commerce and retail websites for currently active, verified purchase deals, coupons, and discounts in India for: "${query}".
Today's date is ${todayStr}.
Target reputable Indian retailers (e.g. Amazon.in, Flipkart, Myntra, Ajio, Croma, Swiggy, Nykaa, or official brand stores).
Extract genuine retail prices, MRP, real instant bank discounts or coupons, and EXACT merchant product URLs (prefer exact product page, fallback to direct search query URL).
Do NOT invent products, fake prices, or expired coupons.

Return ONLY a valid JSON array of verified deal objects with this exact structure:
[
  {
    "title": "Exact Product Name with storage/size/spec",
    "platform": "Merchant or Brand Name",
    "category": "Electronics",
    "originalPrice": 2499,
    "currentPrice": 1499,
    "discountPercent": 40,
    "couponCode": "FLAT200",
    "cashbackText": "Bank/Card offer if applicable",
    "deliveryCharge": 0,
    "finalPrice": 1299,
    "savingsAmount": 1200,
    "dealUrl": "Exact merchant product URL or search URL",
    "sourceUrl": "Source domain or retailer site",
    "offerConditions": ["Applicable on Prepaid orders or HDFC Card"],
    "bestReason": "Verified live retailer discount with coupon."
  }
]
Do not wrap in markdown or backticks. Return ONLY the raw JSON array.`
        : `Search live Indian e-commerce platforms for the strongest, currently verified retail deals, promotional discounts, and verified coupons in India across consumer categories: Food & Dining (Swiggy, Zomato), Groceries (Blinkit, Zepto, Amazon Fresh), Fashion & Footwear (Myntra, Ajio, Nike), Electronics & Audio (Amazon.in, Flipkart, Croma, Sony, boAt), Travel (MakeMyTrip, Cleartrip), and Home.
Today's date is ${todayStr}.
User spending profile: User frequently spends on: ${topCatString}. Surface compelling verified offers that help save in these categories alongside other standout Indian deals.

CRITICAL INSTRUCTIONS:
1. DO NOT force arbitrary category quotas. Do NOT invent deals just to satisfy a category. Only return genuinely verified current offers supported by real merchant data. If a category has no strong verified offer today, return 0 deals for it.
2. Ensure broad multi-category coverage across Indian everyday life (Food, Groceries, Fashion, Tech). Do NOT focus solely on any single device or category.
3. Extract actual merchant prices, genuine MRP, instant discounts, verified coupon codes, and EXACT product links where available.
4. Return between 6 and 12 top verified deals.

Return ONLY a valid JSON array of verified deal objects with this exact structure:
[
  {
    "title": "Exact Product or Offer Name",
    "platform": "Merchant (e.g. Myntra, Swiggy, Amazon.in, Flipkart, Blinkit)",
    "category": "Fashion",
    "originalPrice": 2999,
    "currentPrice": 1799,
    "discountPercent": 40,
    "couponCode": "SAVE40",
    "cashbackText": "Flat ₹200 off with code",
    "deliveryCharge": 0,
    "finalPrice": 1599,
    "savingsAmount": 1400,
    "dealUrl": "Exact merchant product or offer URL",
    "sourceUrl": "Merchant website",
    "offerConditions": ["Valid on orders above ₹999"],
    "bestReason": "Verified 40% discount on Myntra with active coupon."
  }
]
Do not wrap in markdown or backticks. Return ONLY the raw JSON array.`;

    const candidateModels = ['gemini-2.5-flash', 'gemini-3.6-flash'];
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          let rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (rawJson) {
            if (rawJson.startsWith('```')) {
              rawJson = rawJson.replace(/^```json?\s*/i, '').replace(/\s*```$/, '');
            }
            const parsed = JSON.parse(rawJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const shaped = parsed
                .map((d: any) => this.toProviderDeal(d, expiryMinStr))
                .filter((d: ProviderDealResult | null): d is ProviderDealResult => d !== null);
              if (shaped.length > 0) return shaped;
            }
          }
        }
      } catch (err: unknown) {
        this.logger.warn(`Gemini (${model}) Grounded Deals search error: ${err}`);
      }
    }
    return null;
  }

  /** Fallback generation with verified Indian retail market realism when web search tool is limited. */
  private async searchStandard(
    query: string | undefined,
    geminiKey: string,
    todayStr: string,
    expiryMinStr: string,
    profile: UserFinancialProfile,
  ): Promise<ProviderDealResult[]> {
    const topCatString =
      profile.topCategories.length > 0
        ? profile.topCategories.map((c) => `${c.category} (₹${formatINR(c.spent)})`).join(', ')
        : 'Food, Shopping, Groceries';

    const prompt = `You are TrackKaro's Indian Deal Intelligence Engine. Today's date is ${todayStr} (Year 2026).
Find current, realistic promotional discounts and offers available in India across platforms like Amazon.in, Flipkart, Myntra, Swiggy, Zomato, Croma, Blinkit, Nykaa, or MakeMyTrip ${
      query && query !== 'All'
        ? `specifically for: "${query}". Every returned item MUST be a genuine offer directly relevant to "${query}".`
        : `with high-quality verified offers across major Indian consumer categories (Food, Groceries, Fashion, Electronics, Travel). User spends heavily on: ${topCatString}.`
    }.

AUTHENTIC INDIAN MARKET BENCHMARKS (INR):
- Myntra Fashion / Footwear: 30% - 50% discount on Nike/Puma/Levis with coupons.
- Swiggy / Zomato: ₹100 - ₹150 off with codes on gourmet and top restaurants.
- Blinkit / Zepto: 10% - 15% cashback or flat ₹100 off on first monthly pantry orders.
- Audio (Sony WH-CH520 / boAt Nirvana): MRP ₹4,990, discounted to ₹3,499 on Amazon/Croma.
- Laptops / Gadgets: Authentic 10% - 20% festive/card offers.
- MakeMyTrip / Cleartrip: Instant ₹1,000 - ₹1,500 bank discount on domestic flights.

CRITICAL: Return only genuine, verified offers. Do not invent products or inflate discounts. Do NOT focus exclusively on iPhones.
Categories must be one of: "Electronics", "Fashion", "Food", "Beauty", "Travel", "Home".

Return ONLY a valid JSON array matching this format:
[
  {
    "title": "Product or Offer Title",
    "platform": "Merchant (e.g. Myntra, Amazon.in, Swiggy)",
    "category": "Fashion",
    "originalPrice": 4999,
    "currentPrice": 2999,
    "discountPercent": 40,
    "couponCode": "SAVE40",
    "cashbackText": "Instant ₹200 off with code",
    "deliveryCharge": 0,
    "finalPrice": 2799,
    "savingsAmount": 2200,
    "expiryDate": "${expiryMinStr}",
    "bestReason": "Verified 40% discount on Myntra with active coupon.",
    "rating": 4.5,
    "dealUrl": "https://www.myntra.com/running-shoes",
    "sourceUrl": "myntra.com",
    "offerConditions": ["Valid on orders above ₹1,499"]
  }
]
Return ONLY a valid raw JSON array without markdown backticks.`;

    const candidateModels = ['gemini-3.6-flash', 'gemini-2.5-flash'];
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json',
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (rawJson) {
            const parsed = JSON.parse(rawJson);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const shaped = parsed
                .map((d: any) => this.toProviderDeal(d, expiryMinStr))
                .filter((d: ProviderDealResult | null): d is ProviderDealResult => d !== null);
              if (shaped.length > 0) return shaped;
            }
          }
        }
      } catch (err: unknown) {
        this.logger.warn(`Gemini standard generation error: ${err}`);
      }
    }

    return [];
  }
}
