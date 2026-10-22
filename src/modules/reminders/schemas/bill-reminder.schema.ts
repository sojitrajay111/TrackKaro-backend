import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type BillReminderDocument = HydratedDocument<BillReminder>;

export const REMINDER_FREQUENCIES = ['Monthly', 'Quarterly', 'Yearly', 'One-time'] as const;
export type ReminderFrequency = (typeof REMINDER_FREQUENCIES)[number];

export const REMINDER_STATUSES = ['pending', 'paid'] as const;
export type ReminderStatus = (typeof REMINDER_STATUSES)[number];

/** One settled occurrence of a recurring bill. Marking a recurring bill paid appends one of
 * these and rolls dueDate/reminderDate forward, so each period keeps its own paid record. */
@Schema({ _id: false })
export class ReminderPayment {
  /** The due date this payment settled (YYYY-MM-DD). */
  @Prop({ required: true })
  dueDate!: string;

  /** The alert date that occurrence had, so an undo can restore it exactly. */
  @Prop({ required: true })
  reminderDate!: string;

  @Prop({ required: true })
  paidAt!: Date;

  @Prop({ required: true })
  amountMinor!: number;
}

export const ReminderPaymentSchema = SchemaFactory.createForClass(ReminderPayment);

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

  /** Set the moment status flips to 'paid' (and cleared if reverted to 'pending') so a real
   * on-time-payment rate can be computed later — dueDate/reminderDate alone can't tell us that. */
  @Prop()
  paidAt?: Date;

  /** Settled occurrences of a recurring bill, oldest first (always empty for One-time bills). */
  @Prop({ type: [ReminderPaymentSchema], default: [] })
  payments!: ReminderPayment[];
}

export const BillReminderSchema = SchemaFactory.createForClass(BillReminder);

BillReminderSchema.index({ userId: 1, status: 1, dueDate: 1 });
