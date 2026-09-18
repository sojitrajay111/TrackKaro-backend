import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.subscriptionsService.findAll(user.userId);
  }

  @Get('stats')
  async getStats(@CurrentUser() user: CurrentUserPayload) {
    return { monthlyChangePercent: await this.subscriptionsService.getMonthlyChangePercent(user.userId) };
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateSubscriptionDto) {
    return this.subscriptionsService.create(user.userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.subscriptionsService.remove(user.userId, id);
  }
}
