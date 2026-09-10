import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

/**
 * One row per issued refresh token. Only the SHA-256 hash of the token is stored — the raw
 * value is never persisted. `familyId` links every token descended from one login event;
 * rotation replaces a row's hash and issues a new row in the same family. If a token already
 * marked `revoked` is ever presented again, the whole family is revoked (reuse/theft signal).
 */
@Schema({ timestamps: true })
export class RefreshToken {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  tokenHash!: string;

  @Prop({ required: true, index: true })
  familyId!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: false })
  revoked!: boolean;

  @Prop()
  replacedByHash?: string;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

// TTL index — Mongo automatically deletes a document once `expiresAt` is in the past.
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
