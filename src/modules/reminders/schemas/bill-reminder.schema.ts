import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type BillReminderDocument = HydratedDocument<BillReminder>;

export const REMINDER_FREQUENCIES = ['Monthly', 'Quarterly', 'Yearly', 'One-time'] as const;
export type ReminderFrequency = (typeof REMINDER_FREQUENCIES)[number];

export const REMINDER_STATUSES = ['pending', 'paid'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

@Schema({ timestamps: true })
export class BillReminder {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true })
  category!: string;

  @Prop({ required: true })
  amountMinor!: number;

  @Prop({ required: true })
  dueDate!: string;

  @Prop({ required: true })
  reminderDate!: string;

  @Prop({ required: true, enum: REMINDER_FREQUENCIES })
  frequency!: ReminderFrequency;

  @Prop({ required: true, enum: REMINDER_STATUSES, default: 'pending' })
  status!: ReminderStatus;

  @Prop()
  notes?: string;
}

export const BillReminderSchema = SchemaFactory.createForClass(BillReminder);

BillReminderSchema.index({ userId: 1, status: 1, dueDate: 1 });
