import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

export const BILLING_CYCLES = ['Monthly', 'Yearly'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true })
  category!: string;

  @Prop({ required: true })
  amountMinor!: number;

  @Prop({ required: true, enum: BILLING_CYCLES })
  billingCycle!: BillingCycle;

  @Prop({ required: true })
  nextBillingDate!: string;

  @Prop({ required: true })
  annualCostMinor!: number;

  @Prop({ required: true })
  icon!: string;

  @Prop({ default: false })
  isRedundant?: boolean;

  @Prop()
  redundancyReason?: string;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
