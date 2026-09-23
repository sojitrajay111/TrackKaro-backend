import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { DealsService } from './deals.service';
import { TrackDealDto } from './dto/track-deal.dto';
import { SetDealAlertDto } from './dto/set-deal-alert.dto';
import { MarketplaceDealsService } from './engine/marketplace-deals.service';
import { DealsEngineMode } from './types';

@Controller('deals')
export class DealsController {
  constructor(
    private readonly dealsService: DealsService,
    private readonly marketplaceDealsService: MarketplaceDealsService,
  ) {}

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.dealsService.findAll(user.userId);
  }

  /**
   * Provider-neutral deal search — the new response envelope (see `engine/types.ts`) is
   * `{ status: 'success'|'unavailable'|'error', engine, message?, deals }`. Defaults to the
   * 'provider' engine (real marketplace data only, never AI-generated); pass `?engine=legacy` to
   * opt into the old Gemini-generated comparison engine for this one request.
   */
  @Get('search')
  searchRealDeals(
    @CurrentUser() user: CurrentUserPayload,
    @Query('q') query?: string,
    @Query('engine') engine?: string,
  ) {
    let engineOverride: DealsEngineMode | undefined;
    if (engine !== undefined) {
      if (engine !== 'provider' && engine !== 'legacy') {
        throw new BadRequestException('engine must be "provider" or "legacy"');
      }
      engineOverride = engine;
    }
    return this.marketplaceDealsService.searchDeals(user.userId, query, engineOverride);
  }

  /** Create/update/disable a price-drop alert on a specific provider-mode merchant offer
   * (`offerId` from a `GET /deals/search` result's `offerId`). Provider-neutral — replaces
   * `PATCH /deals/:id/track` for offers coming from the new engine. */
  @Patch('offers/:offerId/alert')
  setAlert(
    @CurrentUser() user: CurrentUserPayload,
    @Param('offerId', ParseObjectIdPipe) offerId: string,
    @Body() dto: SetDealAlertDto,
  ) {
    return this.marketplaceDealsService.setAlert(user.userId, offerId, dto);
  }

  /** Records a click-through on a merchant offer and returns where to send the user — a real
   * resolved affiliate link once a provider implements one, or the offer's plain deal URL until
   * then (never a synthesized/guessed affiliate URL). */
  @Post('offers/:offerId/click')
  recordClick(
    @CurrentUser() user: CurrentUserPayload,
    @Param('offerId', ParseObjectIdPipe) offerId: string,
  ) {
    return this.marketplaceDealsService.recordClick(user.userId, offerId);
  }

  @Patch(':id/track')
  toggleTrack(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: TrackDealDto,
  ) {
    return this.dealsService.toggleTrack(user.userId, id, dto.targetPrice);
  }

  @Post(':id/simulate-drop')
  simulateDrop(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: TrackDealDto,
  ) {
    return this.dealsService.simulateDrop(user.userId, id, dto.targetPrice);
  }
}
