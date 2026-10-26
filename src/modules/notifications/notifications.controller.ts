import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { RegisterPushTokenDto, RemovePushTokenDto } from './dto/push-token.dto';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.findAll(user.userId);
  }

  /** The app's FCM token for this device (sent after the user allows notifications). */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  async registerToken(@CurrentUser() user: CurrentUserPayload, @Body() dto: RegisterPushTokenDto) {
    await this.notificationsService.registerPushToken(user.userId, dto.token, dto.platform);
    return { success: true };
  }

  @Post('token/remove')
  @HttpCode(HttpStatus.OK)
  async removeToken(@CurrentUser() user: CurrentUserPayload, @Body() dto: RemovePushTokenDto) {
    await this.notificationsService.removePushToken(user.userId, dto.token);
    return { success: true };
  }

  @Patch('read-all')
  markAllRead(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.markAllRead(user.userId);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseObjectIdPipe) id: string) {
    return this.notificationsService.markRead(user.userId, id);
  }

  @Delete()
  clearAll(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.clearAll(user.userId);
  }
}
