import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PasswordResetOtpDocument = HydratedDocument<PasswordResetOtp>;

const MAX_VERIFY_ATTEMPTS = 5;

@Schema({ timestamps: true })
export class PasswordResetOtp {
  @Prop({ required: true, lowercase: true, trim: true, index: true })
  email!: string;

  @Prop({ required: true })
  otpHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ default: 0 })
  attempts!: number;
}

export const PasswordResetOtpSchema = SchemaFactory.createForClass(PasswordResetOtp);

// TTL index — Mongo automatically deletes the document once expiresAt passes, so expired/used
// codes don't pile up and a fresh forgot-password call always starts from a clean slate.
PasswordResetOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export { MAX_VERIFY_ATTEMPTS };
