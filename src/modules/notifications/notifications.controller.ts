import { Controller, Delete, Get, Param, Patch } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.findAll(user.userId);
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.notificationsService.markRead(user.userId, id);
  }

  @Delete()
  clearAll(@CurrentUser() user: CurrentUserPayload) {
    return this.notificationsService.clearAll(user.userId);
  }
}
