import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;

export const TRANSACTION_TYPES = ['expense', 'income'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const PAYMENT_METHODS = ['UPI', 'Credit Card', 'Debit Card', 'Cash', 'Net Banking'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  merchant!: string;

  @Prop({ required: true })
  amountMinor!: number;

  @Prop({ required: true, enum: TRANSACTION_TYPES })
  type!: TransactionType;

  @Prop({ required: true })
  category!: string;

  @Prop({ required: true })
  date!: string;

  @Prop({ required: true, enum: PAYMENT_METHODS })
  paymentMethod!: PaymentMethod;

  @Prop({ type: [String] })
  people?: string[];

  @Prop()
  notes?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);

TransactionSchema.index({ userId: 1, date: -1 });
TransactionSchema.index({ userId: 1, category: 1, date: -1 });
