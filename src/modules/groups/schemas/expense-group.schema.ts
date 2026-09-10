import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const GROUP_CATEGORIES = [
  'Travel',
  'Home & Utilities',
  'Event & Party',
  'Office & Work',
  'Other',
] as const;
export type GroupCategory = (typeof GROUP_CATEGORIES)[number];

export const GROUP_MEMBER_STATUSES = ['ghost', 'registered'] as const;
export type GroupMemberStatus = (typeof GROUP_MEMBER_STATUSES)[number];

/**
 * A member is a record, not necessarily an account. `linkedUserId` is populated lazily by
 * phone match — this sets up future bidirectional group sync without building it now.
 * Groups stay single-owner-writes (matching the pre-backend app exactly); true multi-account
 * shared-write groups are a separate future design.
 */
@Schema({ _id: false })
export class GroupMember {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  linkedUserId?: Types.ObjectId | null;

  @Prop({ required: true, enum: GROUP_MEMBER_STATUSES, default: 'ghost' })
  status!: GroupMemberStatus;
}

export const GroupMemberSchema = SchemaFactory.createForClass(GroupMember);

export type ExpenseGroupDocument = HydratedDocument<ExpenseGroup>;

@Schema({ timestamps: true })
export class ExpenseGroup {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, enum: GROUP_CATEGORIES })
  category!: GroupCategory;

  @Prop({ type: [GroupMemberSchema], required: true })
  members!: GroupMember[];

  declare createdAt: Date;
}

export const ExpenseGroupSchema = SchemaFactory.createForClass(ExpenseGroup);
