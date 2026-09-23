import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type DealClickDocument = HydratedDocument<DealClick>;

/**
 * Append-only record of a user clicking through to a merchant offer. Records whatever
 * `destinationUrl` was actually used to redirect the user — `isAffiliateResolved` distinguishes
 * a real resolved affiliate link from a plain fallback to the offer's own `dealUrl` (true for
 * every provider today, since no affiliate-link resolver is implemented yet).
 */
@Schema({ timestamps: true })
export class DealClick {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'MerchantOffer', required: true, index: true })
  merchantOfferId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Product', required: true })
  productId!: Types.ObjectId;

  @Prop({ required: true })
  providerId!: string;

  @Prop({ required: true })
  destinationUrl!: string;

  @Prop({ required: true, default: false })
  isAffiliateResolved!: boolean;

  declare createdAt: Date;
}

export const DealClickSchema = SchemaFactory.createForClass(DealClick);
