import { Controller, Get } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { SavingsService } from './savings.service';

@Controller('savings')
export class SavingsController {
  constructor(private readonly savingsService: SavingsService) {}

  @Get('metrics')
  getMetrics(@CurrentUser() user: CurrentUserPayload) {
    return this.savingsService.getFullMetrics(user.userId);
  }
}
