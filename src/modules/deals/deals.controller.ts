import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { DealsService } from './deals.service';
import { TrackDealDto } from './dto/track-deal.dto';

@Controller('deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.dealsService.findAll(user.userId);
  }

  @Get('search')
  searchRealDeals(@CurrentUser() user: CurrentUserPayload, @Query('q') query?: string) {
    return this.dealsService.findRealDealsWithAI(user.userId, query);
  }

  @Patch(':id/track')
  toggleTrack(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: TrackDealDto,
  ) {
    return this.dealsService.toggleTrack(user.userId, id, dto.targetPrice);
  }

  @Post(':id/simulate-drop')
  simulateDrop(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: TrackDealDto,
  ) {
    return this.dealsService.simulateDrop(user.userId, id, dto.targetPrice);
  }
}
