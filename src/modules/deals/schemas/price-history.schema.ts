import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type PriceHistoryDocument = HydratedDocument<PriceHistory>;

/**
 * One observed price point for a `MerchantOffer`, appended every time that offer is (re)ingested
 * from a verified provider response. Immutable, append-only — never updated or deleted, so
 * "is this actually a low price?" questions (`DealEngineService#priceHistoryComparison`) can be
 * answered from real history rather than a single current snapshot.
 */
@Schema({ timestamps: false })
export class PriceHistory {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'MerchantOffer', required: true, index: true })
  merchantOfferId!: Types.ObjectId;

  /** Denormalized for fast product-level ("across all merchants") history queries. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true, index: true })
  productId!: Types.ObjectId;

  @Prop({ required: true })
  priceMinor!: number;

  @Prop({ required: true })
  finalPriceMinor!: number;

  @Prop({ required: true, index: true })
  observedAt!: Date;
}

export const PriceHistorySchema = SchemaFactory.createForClass(PriceHistory);
PriceHistorySchema.index({ merchantOfferId: 1, observedAt: -1 });
