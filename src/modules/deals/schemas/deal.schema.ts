import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type DealDocument = HydratedDocument<Deal>;

@Schema({ timestamps: true })
export class Deal {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true })
  platform!: string;

  @Prop({ required: true })
  category!: string;

  @Prop({ required: true })
  originalPriceMinor!: number;

  @Prop({ required: true })
  currentPriceMinor!: number;

  @Prop({ required: true })
  discountPercent!: number;

  @Prop()
  couponCode?: string;

  @Prop()
  cashbackText?: string;

  @Prop({ required: true, default: 0 })
  deliveryChargeMinor!: number;

  @Prop({ required: true })
  finalPriceMinor!: number;

  @Prop({ required: true })
  savingsAmountMinor!: number;

  @Prop({ required: true })
  expiryDate!: string;

  @Prop({ required: true })
  bestReason!: string;

  @Prop()
  rating?: number;

  @Prop()
  imageUrl?: string;

  @Prop({ default: false })
  tracked?: boolean;

  @Prop()
  targetPriceMinor?: number;
}

export const DealSchema = SchemaFactory.createForClass(Deal);
