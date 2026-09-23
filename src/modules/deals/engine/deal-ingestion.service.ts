import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { toMinorUnits } from '@/common/money/money.util';
import { ProviderDealResult } from '../providers/deals-provider.interface';
import { MerchantOffer, MerchantOfferDocument } from '../schemas/merchant-offer.schema';
import { PriceHistory, PriceHistoryDocument } from '../schemas/price-history.schema';
import { Product, ProductDocument } from '../schemas/product.schema';

/**
 * Turns verified `ProviderDealResult`s (already-normalized data from a real `DealsProvider`)
 * into the canonical, provider-neutral catalog: `Product` (deduplicated identity) →
 * `MerchantOffer` (this provider's specific listing for it) → `PriceHistory` (an appended
 * observation). Only ever called with data from a real marketplace provider — never with
 * legacy Gemini output (see CLAUDE.md "Deals provider architecture": Gemini stays out of this
 * factual pipeline entirely).
 */
@Injectable()
export class DealIngestionService {
  private readonly logger = new Logger(DealIngestionService.name);

  constructor(
    @InjectModel(Product.name) private readonly productModel: Model<ProductDocument>,
    @InjectModel(MerchantOffer.name) private readonly offerModel: Model<MerchantOfferDocument>,
    @InjectModel(PriceHistory.name) private readonly priceHistoryModel: Model<PriceHistoryDocument>,
  ) {}

  /** Heuristic de-dup key: lowercased, punctuation-stripped brand+title. Two listings for the
   * same real product from different providers should collide here; a stronger identifier
   * (GTIN/EAN/MPN) would be a straightforward upgrade once a provider actually supplies one. */
  buildNormalizedKey(input: { title: string; brand?: string }): string {
    const clean = (s: string) =>
      s
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, '-');
    const brandPart = clean(input.brand || '');
    const titlePart = clean(input.title);
    return brandPart ? `${brandPart}__${titlePart}` : titlePart;
  }

  async ingest(providerId: string, deals: ProviderDealResult[]): Promise<MerchantOfferDocument[]> {
    const offers: MerchantOfferDocument[] = [];
    for (const d of deals) {
      try {
        offers.push(await this.ingestOne(providerId, d));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[deals] failed to ingest one offer from "${providerId}": ${message}`);
      }
    }
    return offers;
  }

  private async ingestOne(
    providerId: string,
    d: ProviderDealResult,
  ): Promise<MerchantOfferDocument> {
    const normalizedKey = this.buildNormalizedKey({ title: d.title });

    const product = await this.productModel
      .findOneAndUpdate(
        { normalizedKey },
        {
          $set: { title: d.title, category: d.category },
          $setOnInsert: { normalizedKey },
          $addToSet: d.imageUrl ? { images: d.imageUrl } : { images: { $each: [] } },
        },
        { upsert: true, new: true },
      )
      .exec();

    const offerFilter = d.providerProductId
      ? { providerId, providerProductId: d.providerProductId }
      : { providerId, dealUrl: d.dealUrl };

    const now = new Date();
    const finalMinor = toMinorUnits(d.finalPrice);

    const offer = await this.offerModel
      .findOneAndUpdate(
        offerFilter,
        {
          $set: {
            productId: product._id,
            providerId,
            providerProductId: d.providerProductId,
            title: d.title,
            platform: d.platform,
            originalPriceMinor: toMinorUnits(d.originalPrice),
            currentPriceMinor: toMinorUnits(d.currentPrice),
            deliveryChargeMinor: toMinorUnits(d.deliveryCharge),
            finalPriceMinor: finalMinor,
            couponCode: d.couponCode,
            cashbackText: d.cashbackText,
            dealUrl: d.dealUrl,
            imageUrl: d.imageUrl,
            rating: d.rating,
            priceVerified: d.priceVerified ?? false,
            urlVerified: d.urlVerified ?? false,
            observedAt: now,
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    await this.priceHistoryModel.create({
      merchantOfferId: offer._id,
      productId: product._id,
      priceMinor: offer.currentPriceMinor,
      finalPriceMinor: finalMinor,
      observedAt: now,
    });

    return offer;
  }
}
