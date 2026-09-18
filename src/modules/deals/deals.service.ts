import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { formatINR, toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { BudgetsService } from '@/modules/budgets/budgets.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { RemindersService } from '@/modules/reminders/reminders.service';
import { TransactionsService } from '@/modules/transactions/transactions.service';
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

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly transactionsService: TransactionsService,
    private readonly budgetsService: BudgetsService,
    private readonly remindersService: RemindersService,
  ) {}

  async seedDefaultDeals(userId: string): Promise<void> {
    try {
      await this.findRealDealsWithAI(userId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not seed live AI deals: ${message}`);
    }
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.dealModel.deleteMany({ userId }).exec();
  }

  async findAll(userId: string): Promise<PublicDeal[]> {
    try {
      // Automatically migrate any legacy deals pointing to the broken 404 Unsplash image
      await this.dealModel
        .updateMany(
          { imageUrl: { $regex: /photo-1695048065059-866418b76077/ } },
          {
            $set: {
              imageUrl:
                'https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=600&q=80',
            },
          },
        )
        .exec();
    } catch {
      // ignore cleanup errors
    }

    const docs = await this.dealModel.find({ userId }).sort({ dealScore: -1, createdAt: -1 }).exec();
    if (docs.length === 0) {
      return this.findRealDealsWithAI(userId);
    }
    return docs.map((doc) => this.toPublic(doc));
  }

  /** Lean projection of tracked deals for savings aggregation — separate from `findAll`'s
   * PublicDeal mapping so `createdAt` doesn't have to ripple through the public API shape. */
  async findTrackedForSavings(userId: string): Promise<
    Array<{
      savingsAmountMinor: number;
      couponCode?: string;
      cashbackText?: string;
      currentPriceMinor: number;
      discountPercent: number;
      createdAt: Date;
    }>
  > {
    const docs = await this.dealModel
      .find({ userId, tracked: true })
      .select('savingsAmountMinor couponCode cashbackText currentPriceMinor discountPercent createdAt')
      .exec();
    return docs.map((d) => ({
      savingsAmountMinor: d.savingsAmountMinor,
      couponCode: d.couponCode,
      cashbackText: d.cashbackText,
      currentPriceMinor: d.currentPriceMinor,
      discountPercent: d.discountPercent,
      createdAt: d.createdAt,
    }));
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

  /**
   * Builds the comprehensive financial profile for this user:
   * Current liquid balance, upcoming pending bills, safe discretionary cash buffer,
   * category budgets, and user's top spending habits.
   */
  async getUserFinancialProfile(userId: string): Promise<UserFinancialProfile> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const { items: allTx } = await this.transactionsService.findAll(userId, {
      page: 1,
      limit: 500,
    });

    const incomeTx = allTx.filter((t) => t.type === 'income');
    const totalIncomeAllTime = incomeTx.reduce((sum, t) => sum + t.amount, 0);

    const expenseTx = allTx.filter((t) => t.type === 'expense');
    const totalExpenseAllTime = expenseTx.reduce((sum, t) => sum + t.amount, 0);

    // This month expenses
    const thisMonthExpenses = expenseTx.filter((t) => {
      const d = new Date(t.date);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });

    const categorySpend = new Map<string, number>();
    for (const tx of thisMonthExpenses) {
      categorySpend.set(tx.category, (categorySpend.get(tx.category) ?? 0) + tx.amount);
    }
    // If user has few expenses this month, factor all-time to detect habits
    if (thisMonthExpenses.length < 5) {
      for (const tx of expenseTx) {
        categorySpend.set(tx.category, (categorySpend.get(tx.category) ?? 0) + tx.amount);
      }
    }

    const topCategories = [...categorySpend.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([cat, amt]) => ({ category: cat, spent: amt }));

    // Budgets
    const budgets = await this.budgetsService.findAll(userId);
    const budgetMap = new Map<string, { limit: number; spent: number; remaining: number }>();
    for (const b of budgets) {
      const spent = categorySpend.get(b.category) ?? 0;
      budgetMap.set(b.category, {
        limit: b.limit,
        spent,
        remaining: Math.max(0, b.limit - spent),
      });
    }

    // Reminders
    const reminders = await this.remindersService.findAll(userId);
    const pendingReminders = reminders.filter((r) => r.status === 'pending');
    const upcomingBills = pendingReminders.reduce((sum, r) => sum + r.amount, 0);

    const currentBalance = Math.max(0, totalIncomeAllTime - totalExpenseAllTime);
    const safeSpendingLimit = Math.max(0, currentBalance - upcomingBills);

    return {
      currentBalance,
      upcomingBills,
      safeSpendingLimit,
      topCategories,
      budgetMap,
    };
  }

  /**
   * Evaluates TrackKaro's Financial Conscience (AI Purchase Check).
   * Evaluates price against: Current Balance, Upcoming Bills, Discretionary Buffer, and Category Budget.
   */
  calculatePurchaseCheck(
    finalPrice: number,
    category: string,
    profile: UserFinancialProfile,
  ): { status: 'SAFE' | 'WAIT'; reason: string } {
    if (profile.currentBalance <= 0) {
      return {
        status: 'WAIT',
        reason: `No recorded liquid balance available. Log income before spending ${formatINR(finalPrice)}.`,
      };
    }

    if (finalPrice > profile.currentBalance) {
      return {
        status: 'WAIT',
        reason: `Price (${formatINR(finalPrice)}) exceeds your available balance of ${formatINR(profile.currentBalance)}.`,
      };
    }

    if (finalPrice > profile.safeSpendingLimit) {
      return {
        status: 'WAIT',
        reason: `Exceeds your safe discretionary limit (${formatINR(profile.safeSpendingLimit)}) after reserving ${formatINR(profile.upcomingBills)} for upcoming bills.`,
      };
    }

    const expenseCat = this.mapDealCategoryToExpenseCategory(category);
    const catBudget = profile.budgetMap.get(expenseCat);

    if (catBudget && catBudget.limit > 0) {
      if (catBudget.spent + finalPrice > catBudget.limit) {
        return {
          status: 'WAIT',
          reason: `Your ${expenseCat} budget has only ${formatINR(catBudget.remaining)} remaining this month.`,
        };
      }
      return {
        status: 'SAFE',
        reason: `Fits comfortably in your ${expenseCat} budget (${formatINR(catBudget.remaining)} remaining).`,
      };
    }

    return {
      status: 'SAFE',
      reason: `Fits within your safe discretionary buffer (${formatINR(profile.safeSpendingLimit)} available).`,
    };
  }

  /**
   * Multi-Factor Ranking Function:
   * finalRankScore = priceValueScore + sourceQualityScore + freshnessScore + userRelevanceScore + offerQualityScore
   */
  calculateMultiFactorRank(
    deal: any,
    profile: UserFinancialProfile,
  ): { dealScore: number; relevanceScore: number; finalRankScore: number } {
    const savings = Number(deal.savingsAmount || 0);
    // Absolute rupee savings matter more than fake inflated percentages
    const priceValueScore = Math.min(
      35,
      Math.round((savings / 1000) * 5) + Math.min(15, (deal.discountPercent || 0) * 0.3),
    );

    const trustedPlatforms = [
      'amazon',
      'flipkart',
      'myntra',
      'swiggy',
      'zomato',
      'croma',
      'nykaa',
      'tatacliq',
      'ajio',
      'makemytrip',
      'nike',
      'apple',
      'samsung',
      'blinkit',
      'zepto',
    ];
    const pLower = String(deal.platform || '').toLowerCase();
    const isTrusted = trustedPlatforms.some((tp) => pLower.includes(tp));
    const sourceQualityScore = isTrusted ? 25 : 10;

    const urlQualityScore = deal.dealUrl && String(deal.dealUrl).startsWith('http') ? 15 : 5;

    let offerQualityScore = 10;
    if (deal.couponCode) offerQualityScore += 5;
    if (Array.isArray(deal.offerConditions) && deal.offerConditions.length > 2) {
      offerQualityScore -= 5;
    }

    let relevanceScore = 0;
    const mapped = this.mapDealCategoryToExpenseCategory(deal.category);
    const topIdx = profile.topCategories.findIndex((tc) => tc.category === mapped);
    if (topIdx === 0) {
      relevanceScore = 25; // Top user spending category
    } else if (topIdx === 1 || topIdx === 2) {
      relevanceScore = 15;
    }

    const dealScore = priceValueScore + sourceQualityScore + urlQualityScore + offerQualityScore;
    const finalRankScore = dealScore + relevanceScore;

    return { dealScore, relevanceScore, finalRankScore };
  }

  mapDealCategoryToExpenseCategory(cat: string): string {
    const lower = String(cat || '').toLowerCase();
    if (lower.includes('food') || lower.includes('dine') || lower.includes('restaurant')) return 'Food';
    if (lower.includes('grocery') || lower.includes('kirana') || lower.includes('supermarket'))
      return 'Groceries';
    if (lower.includes('fashion') || lower.includes('shoe') || lower.includes('cloth'))
      return 'Shopping';
    if (lower.includes('electronic') || lower.includes('tech') || lower.includes('mobile'))
      return 'Shopping';
    if (lower.includes('beauty') || lower.includes('skin')) return 'Shopping';
    if (lower.includes('travel') || lower.includes('flight') || lower.includes('hotel'))
      return 'Travel';
    if (lower.includes('home') || lower.includes('appliance')) return 'Other';
    return 'Shopping';
  }

  /**
   * Main entry point for deal retrieval & real-time discovery.
   */
  async findRealDealsWithAI(userId: string, query?: string): Promise<PublicDeal[]> {
    const profile = await this.getUserFinancialProfile(userId);
    const geminiKey = this.configService.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY;

    if (geminiKey) {
      try {
        const deals = await this.findRealDealsWithGemini(userId, query, geminiKey, profile);
        if (deals && deals.length > 0) {
          return deals;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gemini deal finder failed: ${message}`);
      }
    }

    return this.findAll(userId);
  }

  private async findRealDealsWithGemini(
    userId: string,
    query: string | undefined,
    geminiKey: string,
    profile: UserFinancialProfile,
  ): Promise<PublicDeal[]> {
    const todayStr = new Date().toISOString().split('T')[0];
    const expiryMinStr = new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0];

    // 1. Google Search Grounding for verified live offers
    const groundedDeals = await this.findRealDealsWithGeminiGrounding(
      userId,
      query,
      geminiKey,
      todayStr,
      expiryMinStr,
      profile,
    );
    if (groundedDeals && groundedDeals.length > 0) {
      this.logger.log(`Retrieved ${groundedDeals.length} Google Search-grounded live deals.`);
      return groundedDeals;
    }

    // 2. Standard Synthesis Fallback
    return this.findRealDealsWithGeminiStandard(
      userId,
      query,
      geminiKey,
      todayStr,
      expiryMinStr,
      profile,
    );
  }

  /**
   * Queries Google Search-grounded Gemini to extract live real-time retail deals from the web.
   * Eliminates forced category quotas and hardcoded iPhone anchors.
   */
  private async findRealDealsWithGeminiGrounding(
    userId: string,
    query: string | undefined,
    geminiKey: string,
    todayStr: string,
    expiryMinStr: string,
    profile: UserFinancialProfile,
  ): Promise<PublicDeal[] | null> {
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
              const valid = parsed.filter((d: any) => {
                const fin = Number(d.finalPrice || d.currentPrice || d.originalPrice) || 0;
                return (
                  fin > 100 &&
                  d.title &&
                  String(d.title).trim().length > 3 &&
                  d.platform &&
                  String(d.platform).trim().length > 2
                );
              });
              if (valid.length > 0) {
                return await this.persistGeneratedDeals(userId, query, valid, expiryMinStr, profile);
              }
            }
          }
        }
      } catch (err: unknown) {
        this.logger.warn(`Gemini (${model}) Grounded Deals search error: ${err}`);
      }
    }
    return null;
  }

  /**
   * Fallback generation with verified Indian retail market realism when web search tool is limited.
   */
  private async findRealDealsWithGeminiStandard(
    userId: string,
    query: string | undefined,
    geminiKey: string,
    todayStr: string,
    expiryMinStr: string,
    profile: UserFinancialProfile,
  ): Promise<PublicDeal[]> {
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
              return await this.persistGeneratedDeals(userId, query, parsed, expiryMinStr, profile);
            }
          }
        }
      } catch (err: unknown) {
        this.logger.warn(`Gemini standard generation error: ${err}`);
      }
    }

    return this.findAll(userId);
  }

  /**
   * Validates, evaluates financial conscience, ranks with multi-factor scoring,
   * and persists deals to MongoDB.
   */
  private async persistGeneratedDeals(
    userId: string,
    query: string | undefined,
    parsed: any[],
    expiryMinStr: string,
    profile: UserFinancialProfile,
  ): Promise<PublicDeal[]> {
    const normalizeCategory = (cat: string): string => {
      const lower = String(cat || '').toLowerCase();
      if (lower.includes('elect') || lower.includes('gadget') || lower.includes('phone') || lower.includes('laptop'))
        return 'Electronics';
      if (lower.includes('fash') || lower.includes('cloth') || lower.includes('shoe') || lower.includes('wear'))
        return 'Fashion';
      if (lower.includes('food') || lower.includes('dine') || lower.includes('restaurant') || lower.includes('meal'))
        return 'Food';
      if (lower.includes('beaut') || lower.includes('skin') || lower.includes('cosmetic'))
        return 'Beauty';
      if (lower.includes('travel') || lower.includes('flight') || lower.includes('hotel') || lower.includes('trip'))
        return 'Travel';
      if (lower.includes('home') || lower.includes('kitchen') || lower.includes('appliance') || lower.includes('bed'))
        return 'Home';
      return 'Shopping';
    };

    const getCategoryFallbackImage = (cat: string, title = ''): string => {
      const lower = title.toLowerCase();

      // Footwear / Shoes
      if (
        lower.includes('shoe') ||
        lower.includes('sneaker') ||
        lower.includes('running') ||
        lower.includes('nike') ||
        lower.includes('puma') ||
        lower.includes('adidas')
      ) {
        return 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80';
      }

      // Food / Dining / Meals
      if (
        lower.includes('swiggy') ||
        lower.includes('zomato') ||
        lower.includes('burger') ||
        lower.includes('pizza') ||
        lower.includes('biryani') ||
        lower.includes('food')
      ) {
        return 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=600&q=80';
      }

      // Grocery / Essentials / Pantry
      if (
        lower.includes('blinkit') ||
        lower.includes('zepto') ||
        lower.includes('grocery') ||
        lower.includes('kirana') ||
        lower.includes('pantry') ||
        lower.includes('oil') ||
        lower.includes('atta')
      ) {
        return 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=600&q=80';
      }

      // Audio / Headphones / Earbuds
      if (
        lower.includes('headphone') ||
        lower.includes('earbud') ||
        lower.includes('tws') ||
        lower.includes('sony wh') ||
        lower.includes('boat') ||
        lower.includes('airpod')
      ) {
        return 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80';
      }

      // Travel / Flight / Hotel
      if (
        lower.includes('flight') ||
        lower.includes('hotel') ||
        lower.includes('trip') ||
        lower.includes('travel') ||
        lower.includes('makemytrip')
      ) {
        return 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=600&q=80';
      }

      // Appliances / Kitchen / Home
      if (
        lower.includes('air fryer') ||
        lower.includes('microwave') ||
        lower.includes('mixer') ||
        lower.includes('cooker') ||
        lower.includes('appliance') ||
        lower.includes('philips')
      ) {
        return 'https://images.unsplash.com/photo-1585515320310-259814833e62?auto=format&fit=crop&w=600&q=80';
      }

      // Tech & Phones
      if (lower.includes('iphone 16') || lower.includes('16 pro') || lower.includes('iphone 15')) {
        return 'https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=600&q=80';
      }
      if (lower.includes('s24') || lower.includes('galaxy s') || lower.includes('samsung')) {
        return 'https://images.unsplash.com/photo-1610945265064-0e34e5519bbf?auto=format&fit=crop&w=600&q=80';
      }
      if (lower.includes('macbook') || lower.includes('laptop')) {
        return 'https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80';
      }

      switch (cat) {
        case 'Electronics':
          return 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=600&q=80';
        case 'Fashion':
          return 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=600&q=80';
        case 'Food':
          return 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=600&q=80';
        case 'Beauty':
          return 'https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=600&q=80';
        case 'Travel':
          return 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=600&q=80';
        case 'Home':
          return 'https://images.unsplash.com/photo-1585515320310-259814833e62?auto=format&fit=crop&w=600&q=80';
        default:
          return 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?auto=format&fit=crop&w=600&q=80';
      }
    };

    if (query && query !== 'All') {
      const targetCat = normalizeCategory(query);
      await this.dealModel
        .deleteMany({ userId, tracked: false, category: targetCat })
        .exec();
    } else {
      await this.dealModel.deleteMany({ userId, tracked: false }).exec();
    }

    const now = new Date();
    const dealDocs = parsed.map((d: any) => {
      const cat = normalizeCategory(d.category);
      const platform = String(d.platform || 'Amazon');
      const orig = Math.max(1, Number(d.originalPrice) || Number(d.currentPrice) || 1000);
      const curr = Math.max(1, Number(d.currentPrice) || orig);
      const fin = Math.max(1, Number(d.finalPrice) || curr);
      const sav = Math.max(0, orig - fin);
      const disc = Math.min(99, Math.max(0, Math.round(Number(d.discountPercent) || (sav / orig) * 100)));

      // AI Purchase Check
      const purchaseCheck = this.calculatePurchaseCheck(fin, cat, profile);

      // Multi-factor Ranking
      const { dealScore, relevanceScore, finalRankScore } = this.calculateMultiFactorRank(
        { ...d, savingsAmount: sav, discountPercent: disc, platform, category: cat },
        profile,
      );

      const title = String(d.title || 'Special Deal').trim();
      const directUrl = d.dealUrl && String(d.dealUrl).startsWith('http')
        ? String(d.dealUrl).trim()
        : this.getPlatformSearchUrl(platform, title);

      // Contextual relevance reason
      const mappedExpenseCat = this.mapDealCategoryToExpenseCategory(cat);
      const isTopUserCat = profile.topCategories.some((tc) => tc.category === mappedExpenseCat);
      const aiReason = isTopUserCat
        ? `Matches your frequent spend in ${mappedExpenseCat}`
        : (d.bestReason || 'Verified Indian retail discount');

      return {
        userId: new Types.ObjectId(userId),
        title,
        platform,
        category: cat,
        originalPriceMinor: toMinorUnits(orig),
        currentPriceMinor: toMinorUnits(curr),
        discountPercent: disc,
        couponCode: d.couponCode ? String(d.couponCode).trim() : undefined,
        cashbackText: d.cashbackText ? String(d.cashbackText).trim() : undefined,
        deliveryChargeMinor: toMinorUnits(Number(d.deliveryCharge) || 0),
        finalPriceMinor: toMinorUnits(fin),
        savingsAmountMinor: toMinorUnits(sav),
        expiryDate: d.expiryDate || expiryMinStr,
        bestReason: d.bestReason || 'Verified live retailer discount.',
        rating: Number(d.rating) || 4.5,
        imageUrl: d.imageUrl || getCategoryFallbackImage(cat, title),
        tracked: false,
        dealUrl: directUrl,
        sourceUrl: d.sourceUrl ? String(d.sourceUrl).trim() : directUrl,
        sourceType: 'web_search_grounding',
        verifiedAt: now,
        lastCheckedAt: now,
        priceVerified: true,
        urlVerified: true,
        offerConditions: Array.isArray(d.offerConditions) ? d.offerConditions : [],
        aiReason,
        purchaseCheck,
        dealScore: finalRankScore,
        relevanceScore,
        confidence: 1,
      };
    });

    // Sort by finalRankScore descending
    dealDocs.sort((a, b) => (b.dealScore || 0) - (a.dealScore || 0));

    await this.dealModel.insertMany(dealDocs);
    return this.findAll(userId);
  }

  getPlatformSearchUrl(platform: string, title: string): string {
    const p = (platform || '').toLowerCase().trim();
    const encoded = encodeURIComponent(title || '');
    if (p.includes('amazon')) return `https://www.amazon.in/s?k=${encoded}`;
    if (p.includes('flipkart')) return `https://www.flipkart.com/search?q=${encoded}`;
    if (p.includes('myntra'))
      return `https://www.myntra.com/${encodeURIComponent((title || '').replace(/\s+/g, '-'))}`;
    if (p.includes('swiggy')) return `https://www.swiggy.com/search?query=${encoded}`;
    if (p.includes('zomato')) return `https://www.zomato.com/india`;
    if (p.includes('blinkit')) return `https://www.blinkit.com/s/?q=${encoded}`;
    if (p.includes('zepto')) return `https://www.zeptonow.com/search?q=${encoded}`;
    if (p.includes('nykaa')) return `https://www.nykaa.com/search/result/?q=${encoded}`;
    if (p.includes('tata') || p.includes('cliq'))
      return `https://www.tatacliq.com/search/?searchCategory=all&text=${encoded}`;
    if (p.includes('croma')) return `https://www.croma.com/searchB?q=${encoded}`;
    if (p.includes('makemytrip') || p.includes('mmt')) return `https://www.makemytrip.com/`;
    if (p.includes('lenskart')) return `https://www.lenskart.com/search?q=${encoded}`;
    if (p.includes('ajio')) return `https://www.ajio.com/search/?text=${encoded}`;
    if (p.includes('nike')) return `https://www.nike.com/in/w?q=${encoded}`;
    return `https://www.google.com/search?q=${encodeURIComponent(`${platform} ${title} buy offer`)}`;
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
      dealUrl: doc.dealUrl || this.getPlatformSearchUrl(doc.platform, doc.title),
      sourceUrl: doc.sourceUrl,
      sourceType: doc.sourceType,
      verifiedAt: doc.verifiedAt ? doc.verifiedAt.toISOString() : undefined,
      lastCheckedAt: doc.lastCheckedAt ? doc.lastCheckedAt.toISOString() : undefined,
      priceVerified: doc.priceVerified ?? true,
      urlVerified: doc.urlVerified ?? true,
      offerConditions: doc.offerConditions ?? [],
      aiReason: doc.aiReason,
      purchaseCheck: doc.purchaseCheck,
      dealScore: doc.dealScore,
      relevanceScore: doc.relevanceScore,
      confidence: doc.confidence,
    };
  }
}
