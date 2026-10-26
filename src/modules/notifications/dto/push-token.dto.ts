import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { PUSH_PLATFORMS, PushPlatform } from '@/modules/users/schemas/user.schema';

/** A device's FCM registration token, sent by the app after the user allows notifications. */
export class RegisterPushTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token!: string;

  @IsOptional()
  @IsIn(PUSH_PLATFORMS)
  platform?: PushPlatform;
}

export class RemovePushTokenDto {
  @IsString()
  @MaxLength(4096)
  token!: string;
}
