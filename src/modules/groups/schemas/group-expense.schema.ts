import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const GROUP_SPLIT_TYPES = ['equal', 'exact', 'percentage'] as const;
export type GroupSplitType = (typeof GROUP_SPLIT_TYPES)[number];

@Schema({ _id: false })
export class GroupExpenseSplit {
  @Prop({ required: true })
  memberName!: string;

  @Prop({ required: true })
  amountMinor!: number;
}

export const GroupExpenseSplitSchema = SchemaFactory.createForClass(GroupExpenseSplit);

export type GroupExpenseDocument = HydratedDocument<GroupExpense>;

@Schema({ timestamps: true })
export class GroupExpense {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'ExpenseGroup', required: true, index: true })
  groupId!: Types.ObjectId;

  // Denormalized for straightforward user-scoped queries without a join back to the group.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true })
  totalAmountMinor!: number;

  @Prop({ required: true })
  paidBy!: string;

  @Prop({ required: true })
  date!: string;

  @Prop({ type: [GroupExpenseSplitSchema], required: true })
  splits!: GroupExpenseSplit[];

  @Prop({ enum: GROUP_SPLIT_TYPES })
  splitType?: GroupSplitType;

  @Prop()
  notes?: string;

  @Prop({ default: false })
  isSettlement?: boolean;

  @Prop()
  settlementFrom?: string;

  @Prop()
  settlementTo?: string;
}

export const GroupExpenseSchema = SchemaFactory.createForClass(GroupExpense);

GroupExpenseSchema.index({ groupId: 1, date: -1 });
