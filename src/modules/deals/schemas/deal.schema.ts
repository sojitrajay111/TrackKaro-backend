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

  @Prop()
  dealUrl?: string;

  @Prop()
  sourceUrl?: string;

  @Prop({ default: 'web_search_grounding' })
  sourceType?: string;

  @Prop({ default: () => new Date() })
  verifiedAt?: Date;

  @Prop({ default: () => new Date() })
  lastCheckedAt?: Date;

  @Prop({ default: true })
  priceVerified?: boolean;

  @Prop({ default: true })
  urlVerified?: boolean;

  @Prop({ type: [String], default: [] })
  offerConditions?: string[];

  @Prop()
  aiReason?: string;

  @Prop({
    type: {
      status: { type: String, enum: ['SAFE', 'WAIT'], default: 'SAFE' },
      reason: { type: String, default: '' },
    },
    default: { status: 'SAFE', reason: '' },
  })
  purchaseCheck?: {
    status: 'SAFE' | 'WAIT';
    reason: string;
  };

  @Prop({ default: 0 })
  dealScore?: number;

  @Prop({ default: 0 })
  relevanceScore?: number;

  @Prop({ default: 1 })
  confidence?: number;

  declare createdAt: Date;
}

export const DealSchema = SchemaFactory.createForClass(Deal);
