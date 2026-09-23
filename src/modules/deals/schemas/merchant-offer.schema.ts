import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const OFFER_AVAILABILITY = ['in_stock', 'out_of_stock', 'unknown'] as const;
export type OfferAvailability = (typeof OFFER_AVAILABILITY)[number];

export type MerchantOfferDocument = HydratedDocument<MerchantOffer>;

/**
 * One marketplace/provider's specific offer for a canonical `Product`. Not `userId`-scoped —
 * shared marketplace data (see `Product`'s doc comment). Only ever written by
 * `DealIngestionService` from verified provider data; the legacy Gemini engine never touches
 * this collection.
 */
@Schema({ timestamps: true })
export class MerchantOffer {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  /** Matches a `DealsProvider.id` (e.g. 'flipkart'). */
  @Prop({ required: true, index: true })
  providerId!: string;

  /** The provider's own listing/product id, when it exposes one — used for an idempotent
   * upsert key instead of re-matching by URL on every refresh. Optional because not every
   * provider necessarily has a stable id to give us. */
  @Prop()
  providerProductId?: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true })
  platform!: string;

  @Prop({ required: true })
  originalPriceMinor!: number;

  @Prop({ required: true })
  currentPriceMinor!: number;

  @Prop({ required: true, default: 0 })
  deliveryChargeMinor!: number;

  @Prop({ required: true })
  finalPriceMinor!: number;

  @Prop()
  couponCode?: string;

  @Prop()
  cashbackText?: string;

  @Prop({ required: true })
  dealUrl!: string;

  /** Resolved by a provider-specific affiliate-link generator (e.g. Cuelinks). Left unset until
   * resolved or generated dynamically — see `providers/cuelinks.provider.ts`. */
  @Prop()
  affiliateUrl?: string;

  @Prop()
  imageUrl?: string;

  @Prop()
  rating?: number;

  @Prop({ enum: OFFER_AVAILABILITY, default: 'unknown' })
  availability?: OfferAvailability;

  /** Whether the provider itself asserted this price as currently accurate. */
  @Prop({ default: false })
  priceVerified?: boolean;

  /** Whether the provider itself asserted `dealUrl` as currently valid. */
  @Prop({ default: false })
  urlVerified?: boolean;

  /** Last time this offer's price/availability was actually confirmed by the provider — the
   * freshness signal `DealCacheService` and the API's `stale` flag are derived from. */
  @Prop({ required: true })
  observedAt!: Date;

  declare createdAt: Date;
}

export const MerchantOfferSchema = SchemaFactory.createForClass(MerchantOffer);
MerchantOfferSchema.index(
  { providerId: 1, providerProductId: 1 },
  { unique: true, partialFilterExpression: { providerProductId: { $type: 'string' } } },
);
