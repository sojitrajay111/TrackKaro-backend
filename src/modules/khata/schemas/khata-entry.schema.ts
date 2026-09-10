import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type KhataEntryDocument = HydratedDocument<KhataEntry>;

export const KHATA_TYPES = ['gave', 'took'] as const;
export type KhataType = (typeof KHATA_TYPES)[number];

export const KHATA_STATUSES = ['pending', 'settled'] as const;
export type KhataStatus = (typeof KHATA_STATUSES)[number];

@Schema({ timestamps: true })
export class KhataEntry {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  personName!: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ required: true })
  amountMinor!: number;

  @Prop({ required: true, enum: KHATA_TYPES })
  type!: KhataType;

  @Prop({ required: true })
  date!: string;

  @Prop()
  dueDate?: string;

  @Prop()
  notes?: string;

  @Prop({ required: true, enum: KHATA_STATUSES, default: 'pending' })
  status!: KhataStatus;
}

export const KhataEntrySchema = SchemaFactory.createForClass(KhataEntry);

KhataEntrySchema.index({ userId: 1, personName: 1, status: 1 });
