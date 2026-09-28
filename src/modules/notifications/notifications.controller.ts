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
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.findAll(user.userId);
  }

  @Post('token')
  @HttpCode(HttpStatus.OK)
  async registerToken(@CurrentUser() user: CurrentUserPayload, @Body('token') token: string) {
    await this.notificationsService.registerPushToken(user.userId, token);
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
