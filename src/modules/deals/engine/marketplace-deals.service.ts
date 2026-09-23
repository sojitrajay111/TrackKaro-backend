import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { DealsService } from '../deals.service';
import { CuelinksDealsProvider } from '../providers/cuelinks.provider';
import { DealsProviderRegistry } from '../providers/deals-provider.registry';
import { DealAlert, DealAlertDocument } from '../schemas/deal-alert.schema';
import { DealClick, DealClickDocument } from '../schemas/deal-click.schema';
import { MerchantOffer, MerchantOfferDocument } from '../schemas/merchant-offer.schema';
import { Product, ProductDocument } from '../schemas/product.schema';
import { DealsEngineMode, UserFinancialProfile } from '../types';
import { DealCacheService } from './deal-cache.service';
import { DealEngineService } from './deal-engine.service';
import { DealIngestionService } from './deal-ingestion.service';
import { DealSearchResponse, PublicMerchantDeal } from './types';

/** A financial profile isn't meaningful input to a real marketplace search (Flipkart doesn't
 * need to know your budget to return a product listing) — only the legacy Gemini provider
 * actually reads it, for prompt personalization. Building the real one costs several DB reads
 * (transactions/budgets/reminders), so provider-mode searches pass this cheap placeholder
 * instead of computing it, and only the legacy path (via `DealsService.discoverDeals`) bothers
 * with the real one. */
const EMPTY_PROFILE: UserFinancialProfile = {
  currentBalance: 0,
  upcomingBills: 0,
  safeSpendingLimit: 0,
  topCategories: [],
  budgetMap: new Map(),
};

/**
 * Orchestrates `GET /deals/search`: the production ('provider') path ingests real, verified
 * marketplace data through `DealIngestionService`/`DealEngineService`/`DealCacheService` and
 * never fabricates a result; the 'legacy' path delegates to the pre-existing Gemini engine
 * (`DealsService.discoverDeals`) unchanged, for comparison. See CLAUDE.md "Deals provider
 * architecture" for the full picture.
 */
@Injectable()
export class MarketplaceDealsService {
  private readonly logger = new Logger(MarketplaceDealsService.name);

  constructor(
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(MerchantOffer.name) private readonly offerModel: Model<MerchantOfferDocument>,
    @InjectModel(DealAlert.name) private readonly dealAlertModel: Model<DealAlertDocument>,
    @InjectModel(DealClick.name) private readonly dealClickModel: Model<DealClickDocument>,
    private readonly dealsService: DealsService,
    private readonly cuelinksProvider: CuelinksDealsProvider,
    private readonly dealsProviderRegistry: DealsProviderRegistry,
    private readonly dealIngestionService: DealIngestionService,
    private readonly dealEngineService: DealEngineService,
    private readonly dealCacheService: DealCacheService,
  ) {}

  async searchDeals(
    userId?: string,
    query?: string,
    engineOverride?: DealsEngineMode,
  ): Promise<DealSearchResponse> {
    const mode = engineOverride ?? this.dealsService.engineMode();

    if (mode === 'legacy') {
      return this.searchLegacy(userId, query);
    }
    return this.searchProviders(userId, query);
  }

  private async searchLegacy(userId?: string, query?: string): Promise<DealSearchResponse> {
    if (!userId) {
      return {
        status: 'unavailable',
        engine: 'legacy',
        message: 'The legacy Gemini engine requires user authentication to personalize deals.',
        deals: [],
      };
    }
    const legacyDeals = await this.dealsService.discoverDeals(userId, query, 'legacy');
    return {
      status: legacyDeals.length > 0 ? 'success' : 'unavailable',
      engine: 'legacy',
      message: legacyDeals.length > 0 ? undefined : 'The legacy Gemini engine returned no deals.',
      deals: legacyDeals.map((d) => ({
        offerId: d.id,
        productId: d.id,
        title: d.title,
        platform: d.platform,
        category: d.category,
        originalPrice: d.originalPrice,
        currentPrice: d.currentPrice,
        discountPercent: d.discountPercent,
        couponCode: d.couponCode,
        cashbackText: d.cashbackText,
        deliveryCharge: d.deliveryCharge,
        finalPrice: d.finalPrice,
        savingsAmount: d.savingsAmount,
        rating: d.rating,
        imageUrl: d.imageUrl,
        dealUrl: d.dealUrl ?? '',
        sourceType: d.sourceType ?? 'gemini-legacy',
        // Deliberately NOT trusting the legacy Deal doc's own priceVerified/urlVerified flags at
        // face value here — those were set true unconditionally by the pre-existing Gemini flow
        // regardless of whether the LLM's output was actually accurate (see
        // GeminiLegacyDealsProvider's doc comment). The new envelope's `priceVerified` is meant
        // to mean "a real marketplace confirmed this", which AI-generated text never did.
        priceVerified: false,
        urlVerified: false,
        observedAt: d.verifiedAt ?? new Date().toISOString(),
        stale: false,
        isAllTimeLow: false,
        lowestObservedPrice: null,
        dealScore: d.dealScore ?? 0,
        alerted: Boolean(d.tracked),
        targetPrice: d.targetPrice,
      })),
    };
  }

  private async searchProviders(userId?: string, query?: string): Promise<DealSearchResponse> {
    for (const provider of this.dealsProviderRegistry.getProviders()) {
      if (!provider.isConfigured()) continue;

      const cached = await this.dealCacheService.getFreshCachedOffers(provider.id, query);
      if (cached && cached.length > 0) {
        return {
          status: 'success',
          engine: 'provider',
          deals: await this.toPublicMerchantDeals(cached, userId),
        };
      }

      try {
        const result = await provider.search({ userId, query, profile: EMPTY_PROFILE });
        if (result.status === 'ok' && result.deals.length > 0) {
          const offers = await this.dealIngestionService.ingest(provider.id, result.deals);
          await this.dealCacheService.logSearch(
            provider.id,
            query,
            'success',
            offers.length,
            undefined,
            offers.map((o) => o._id),
          );

          if (userId && Types.ObjectId.isValid(userId)) {
            try {
              const profile = await this.dealsService.getUserFinancialProfile(userId);
              await this.dealsService.rankAndPersistProviderDeals(
                userId,
                query,
                provider.id,
                result.deals,
                profile,
              );
            } catch (syncErr: unknown) {
              this.logger.warn(`Could not sync deals to user collection: ${String(syncErr)}`);
            }
          }

          return {
            status: 'success',
            engine: 'provider',
            deals: await this.toPublicMerchantDeals(offers, userId),
          };
        }

        const status = result.status === 'error' ? 'error' : 'unavailable';
        await this.dealCacheService.logSearch(provider.id, query, status, 0, result.message);
        this.logger.log(
          `[deals] provider "${provider.id}": ${status} — ${result.message ?? 'no message'}`,
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        await this.dealCacheService.logSearch(provider.id, query, 'error', 0, message);
        this.logger.warn(`[deals] provider "${provider.id}" threw: ${message}`);
      }
    }

    return {
      status: 'unavailable',
      engine: 'provider',
      message:
        'No verified marketplace provider is currently configured or returning data. Set ' +
        'DEALS_ENGINE_MODE=legacy (or pass ?engine=legacy) to use the AI-generated comparison engine instead.',
      deals: [],
    };
  }

  private async toPublicMerchantDeals(
    offers: MerchantOfferDocument[],
    userId?: string,
  ): Promise<PublicMerchantDeal[]> {
    if (offers.length === 0) return [];

    const productIds = [...new Set(offers.map((o) => o.productId.toString()))];
    const products = await this.productModel.find({ _id: { $in: productIds } }).exec();
    const productById = new Map(products.map((p) => [p._id.toString(), p]));

    const alerts =
      userId && Types.ObjectId.isValid(userId)
        ? await this.dealAlertModel
            .find({
              userId: new Types.ObjectId(userId),
              merchantOfferId: { $in: offers.map((o) => o._id) },
            })
            .exec()
        : [];
    const alertByOfferId = new Map(alerts.map((a) => [a.merchantOfferId.toString(), a]));

    const now = new Date();
    return Promise.all(
      offers.map(async (offer) => {
        const product = productById.get(offer.productId.toString());
        const alert = alertByOfferId.get(offer._id.toString());
        const discountPercent = this.dealEngineService.computeDiscountPercent(
          offer.originalPriceMinor,
          offer.finalPriceMinor,
        );
        const { lowestObservedMinor, isAllTimeLow } =
          await this.dealEngineService.priceHistoryComparison(offer._id, offer.finalPriceMinor);
        const dealScore = this.dealEngineService.computeScore({
          discountPercent,
          priceVerified: offer.priceVerified,
          urlVerified: offer.urlVerified,
          couponCode: offer.couponCode,
          rating: offer.rating,
        });

        return {
          offerId: offer._id.toString(),
          productId: offer.productId.toString(),
          title: offer.title,
          platform: offer.platform,
          category: product?.category ?? 'Shopping',
          brand: product?.brand,
          originalPrice: toMajorUnits(offer.originalPriceMinor),
          currentPrice: toMajorUnits(offer.currentPriceMinor),
          discountPercent,
          couponCode: offer.couponCode,
          cashbackText: offer.cashbackText,
          deliveryCharge: toMajorUnits(offer.deliveryChargeMinor),
          finalPrice: toMajorUnits(offer.finalPriceMinor),
          savingsAmount: toMajorUnits(
            Math.max(0, offer.originalPriceMinor - offer.finalPriceMinor),
          ),
          rating: offer.rating,
          imageUrl: offer.imageUrl,
          dealUrl: offer.dealUrl,
          sourceType: offer.providerId,
          priceVerified: offer.priceVerified ?? false,
          urlVerified: offer.urlVerified ?? false,
          observedAt: offer.observedAt.toISOString(),
          stale: this.dealCacheService.isStale(offer.observedAt, now),
          isAllTimeLow,
          lowestObservedPrice:
            lowestObservedMinor !== null ? toMajorUnits(lowestObservedMinor) : null,
          dealScore,
          alerted: Boolean(alert?.enabled),
          targetPrice:
            alert?.targetPriceMinor !== undefined
              ? toMajorUnits(alert.targetPriceMinor)
              : undefined,
        };
      }),
    );
  }

  async setAlert(
    userId: string,
    offerId: string,
    dto: { enabled: boolean; targetPrice?: number },
  ): Promise<DealAlertDocument> {
    const offer = await this.offerModel.findById(offerId).exec();
    if (!offer) throw new NotFoundException('Offer not found');

    return this.dealAlertModel
      .findOneAndUpdate(
        { userId: new Types.ObjectId(userId), merchantOfferId: offer._id },
        {
          $set: {
            enabled: dto.enabled,
            productId: offer.productId,
            targetPriceMinor:
              dto.targetPrice !== undefined ? toMinorUnits(dto.targetPrice) : undefined,
          },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  async recordClick(
    userId: string,
    offerId: string,
  ): Promise<{ redirectUrl: string; isAffiliateResolved: boolean }> {
    const offer = await this.offerModel.findById(offerId).exec();
    if (!offer) throw new NotFoundException('Offer not found');

    let destinationUrl = offer.affiliateUrl || offer.dealUrl;
    let isAffiliateResolved = Boolean(offer.affiliateUrl);

    // If no static affiliate URL exists on the offer, resolve it via Cuelinks
    if (!isAffiliateResolved && this.cuelinksProvider.isConfigured()) {
      const resolved = await this.cuelinksProvider.resolveAffiliateUrl(offer.dealUrl, userId);
      if (resolved) {
        destinationUrl = resolved;
        isAffiliateResolved = true;
      }
    }

    await this.dealClickModel.create({
      userId: new Types.ObjectId(userId),
      merchantOfferId: offer._id,
      productId: offer.productId,
      providerId: offer.providerId,
      destinationUrl,
      isAffiliateResolved,
    });

    return { redirectUrl: destinationUrl, isAffiliateResolved };
  }
}
