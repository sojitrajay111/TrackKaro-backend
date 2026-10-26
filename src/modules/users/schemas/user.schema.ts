import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ trim: true })
  phone?: string;

  /** Optional — used for deal browse suggestions (Amazon search queries). */
  @Prop({ enum: ['male', 'female', 'other', 'unspecified'], default: 'unspecified' })
  gender?: 'male' | 'female' | 'other' | 'unspecified';

  /** FCM registration tokens, one per device that allowed notifications (newest last). */
  @Prop({
    type: [{ token: String, platform: String, updatedAt: Date, _id: false }],
    default: [],
  })
  fcmTokens!: FcmToken[];
}

export const PUSH_PLATFORMS = ['android', 'ios'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

export interface FcmToken {
  token: string;
  platform: PushPlatform;
  updatedAt: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
