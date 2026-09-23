import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export const DEAL_SEARCH_STATUSES = ['success', 'unavailable', 'error'] as const;
export type DealSearchStatus = (typeof DEAL_SEARCH_STATUSES)[number];

export type DealSearchLogDocument = HydratedDocument<DealSearchLog>;

/**
 * A record of one provider search attempt, keyed by (providerId, normalizedQuery). Serves two
 * purposes: observability (what did each provider actually return, and when), and the freshness
 * cache `DealCacheService` reads from to avoid re-hitting a provider for an identical search
 * within the staleness window. Deliberately NOT `userId`-scoped — the cache is shared across
 * users searching the same thing, not personal data.
 */
@Schema({ timestamps: true })
export class DealSearchLog {
  @Prop({ required: true, index: true })
  providerId!: string;

  @Prop({ required: true, index: true })
  normalizedQuery!: string;

  @Prop({ required: true, enum: DEAL_SEARCH_STATUSES })
  status!: DealSearchStatus;

  @Prop({ required: true, default: 0 })
  resultCount!: number;

  @Prop()
  message?: string;

  @Prop({ type: [{ type: MongooseSchema.Types.ObjectId, ref: 'MerchantOffer' }], default: [] })
  offerIds?: Types.ObjectId[];

  @Prop({ required: true, index: true })
  observedAt!: Date;

  declare createdAt: Date;
}

export const DealSearchLogSchema = SchemaFactory.createForClass(DealSearchLog);
