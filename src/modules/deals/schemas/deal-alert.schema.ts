import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type DealAlertDocument = HydratedDocument<DealAlert>;

/**
 * A user's price-drop alert on a specific `MerchantOffer` — the provider-neutral replacement for
 * the old `Deal.tracked`/`targetPriceMinor` fields, used by the new `/deals/search` pipeline.
 * The legacy `Deal` collection's own tracking (`PATCH /deals/:id/track`) is untouched and keeps
 * working for the legacy engine.
 */
@Schema({ timestamps: true })
export class DealAlert {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'MerchantOffer', required: true, index: true })
  merchantOfferId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop()
  targetPriceMinor?: number;

  @Prop({ required: true, default: true })
  enabled!: boolean;

  declare createdAt: Date;
}

export const DealAlertSchema = SchemaFactory.createForClass(DealAlert);
DealAlertSchema.index({ userId: 1, merchantOfferId: 1 }, { unique: true });
