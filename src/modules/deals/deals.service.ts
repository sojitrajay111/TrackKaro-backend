import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { formatINR, toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { AppConfig } from '@/config/configuration';
import { BudgetsService } from '@/modules/budgets/budgets.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { RemindersService } from '@/modules/reminders/reminders.service';
import { TransactionsService } from '@/modules/transactions/transactions.service';
import { DealsProviderRegistry } from './providers/deals-provider.registry';
import { GeminiLegacyDealsProvider } from './providers/gemini-legacy.provider';
import { getPlatformSearchUrl } from './providers/platform-links.util';
import { DealsProvider, ProviderDealResult } from './providers/deals-provider.interface';
import { Deal, DealDocument } from './schemas/deal.schema';
import { DealsEngineMode, PublicDeal, UserFinancialProfile } from './types';

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService<AppConfig>,
    private readonly transactionsService: TransactionsService,
    private readonly budgetsService: BudgetsService,
    private readonly remindersService: RemindersService,
    private readonly dealsProviderRegistry: DealsProviderRegistry,
    private readonly geminiLegacyProvider: GeminiLegacyDealsProvider,
  ) {}

  async seedDefaultDeals(userId: string): Promise<void> {
    try {
      await this.discoverDeals(userId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Could not seed deals: ${message}`);
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

    const docs = await this.dealModel
      .find({ userId })
      .sort({ dealScore: -1, createdAt: -1 })
      .exec();
    if (docs.length === 0) {
      return this.discoverDeals(userId);
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
      .select(
        'savingsAmountMinor couponCode cashbackText currentPriceMinor discountPercent createdAt',
      )
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
    if (lower.includes('food') || lower.includes('dine') || lower.includes('restaurant'))
      return 'Food';
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

  /** Reads the configured deals engine mode (`DEALS_ENGINE_MODE`), defaulting to the production
   * target ('provider') when unset. */
  /** Public so `MarketplaceDealsService` (the new `/deals/search` orchestrator) can resolve the
   * same configured default without duplicating config-reading logic. */
  engineMode(): DealsEngineMode {
    return this.configService.get('deals', { infer: true })?.engineMode ?? 'provider';
  }

  /**
   * Main entry point for deal discovery.
   *
   * 'provider' mode (the target production path, and the default): tries every registered
   * real-marketplace provider (Flipkart today) in order, and stops at the first one that
   * returns real results. It deliberately does NOT fall back to the legacy AI engine — an
   * unconfigured/not-yet-implemented provider should surface as "no deals available", never as
   * an AI-invented substitute, per the core product rule.
   *
   * 'legacy' mode: runs only the old Gemini-generated deal finder, kept for side-by-side
   * comparison during the Flipkart integration rollout. Select it via `DEALS_ENGINE_MODE=legacy`
   * in the environment, or per-request with `?engine=legacy` on `GET /deals/search`.
   */
  async discoverDeals(
    userId: string,
    query?: string,
    engineOverride?: DealsEngineMode,
  ): Promise<PublicDeal[]> {
    const profile = await this.getUserFinancialProfile(userId);
    const mode = engineOverride ?? this.engineMode();

    if (mode === 'legacy') {
      return this.runProvider(this.geminiLegacyProvider, userId, query, profile);
    }

    for (const provider of this.dealsProviderRegistry.getProviders()) {
      if (!provider.isConfigured()) continue;
      const result = await this.runProvider(provider, userId, query, profile);
      if (result.length > 0) return result;
    }

    this.logger.log(
      '[deals] no configured provider produced results — returning empty (no fabrication).',
    );
    return [];
  }

  private async runProvider(
    provider: DealsProvider,
    userId: string,
    query: string | undefined,
    profile: UserFinancialProfile,
  ): Promise<PublicDeal[]> {
    try {
      const result = await provider.search({ userId, query, profile });
      if (result.status !== 'ok' || result.deals.length === 0) {
        if (result.message) {
          this.logger.log(
            `[deals] provider "${provider.id}": ${result.status} — ${result.message}`,
          );
        }
        return [];
      }
      return this.rankAndPersistProviderDeals(userId, query, provider.id, result.deals, profile);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[deals] provider "${provider.id}" threw: ${message}`);
      return [];
    }
  }

  private getCategoryFallbackImage(cat: string, title = ''): string {
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
  }

  /**
   * Provider-agnostic layer: takes already-real deal data from any `DealsProvider`, applies
   * TrackKaro's own interpretation on top (purchase-safety check, multi-factor ranking, a
   * fallback category image when the provider didn't supply one), persists it, and returns the
   * public shape. Nothing in this method invents a product, price or link — it only scores and
   * displays what the provider already gave it.
   */
  async rankAndPersistProviderDeals(
    userId: string,
    query: string | undefined,
    providerId: string,
    deals: ProviderDealResult[],
    profile: UserFinancialProfile,
  ): Promise<PublicDeal[]> {
    const expiryMinStr = new Date(Date.now() + 86400000 * 7).toISOString().split('T')[0];

    // Clear stale untracked deals in whichever categories this batch is about to replace, rather
    // than re-deriving a category from the free-text `query` (which providers' categories don't
    // necessarily share a vocabulary with) — a general, provider-agnostic replace-on-refresh.
    if (query && query !== 'All') {
      const categoriesInBatch = [...new Set(deals.map((d) => d.category))];
      await this.dealModel
        .deleteMany({ userId, tracked: false, category: { $in: categoriesInBatch } })
        .exec();
    } else {
      await this.dealModel.deleteMany({ userId, tracked: false }).exec();
    }

    const now = new Date();
    const dealDocs = deals.map((d) => {
      const purchaseCheck = this.calculatePurchaseCheck(d.finalPrice, d.category, profile);
      const { relevanceScore, finalRankScore } = this.calculateMultiFactorRank(d, profile);

      const mappedExpenseCat = this.mapDealCategoryToExpenseCategory(d.category);
      const isTopUserCat = profile.topCategories.some((tc) => tc.category === mappedExpenseCat);
      const aiReason = isTopUserCat
        ? `Matches your frequent spend in ${mappedExpenseCat}`
        : d.bestReason || 'Deal from ' + providerId;

      return {
        userId: new Types.ObjectId(userId),
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
        expiryDate: d.expiryDate || expiryMinStr,
        bestReason: d.bestReason || 'Deal from ' + providerId,
        rating: d.rating,
        imageUrl: d.imageUrl || this.getCategoryFallbackImage(d.category, d.title),
        tracked: false,
        dealUrl: d.dealUrl || getPlatformSearchUrl(d.platform, d.title),
        sourceUrl: d.sourceUrl ?? d.dealUrl,
        sourceType: providerId,
        verifiedAt: now,
        lastCheckedAt: now,
        priceVerified: d.priceVerified ?? false,
        urlVerified: d.urlVerified ?? false,
        offerConditions: d.offerConditions ?? [],
        aiReason,
        purchaseCheck,
        dealScore: finalRankScore,
        relevanceScore,
        confidence: d.confidence ?? 1,
      };
    });

    // Sort by finalRankScore descending
    dealDocs.sort((a, b) => (b.dealScore || 0) - (a.dealScore || 0));

    await this.dealModel.insertMany(dealDocs);
    return this.findAll(userId);
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
      dealUrl: doc.dealUrl || getPlatformSearchUrl(doc.platform, doc.title),
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
