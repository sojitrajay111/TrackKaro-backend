import { Body, Controller, Get, Param, Put } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { BudgetsService } from './budgets.service';
import { SetBudgetDto } from './dto/set-budget.dto';

@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.budgetsService.findAll(user.userId);
  }

  @Put(':category')
  upsert(
    @CurrentUser() user: CurrentUserPayload,
    @Param('category') category: string,
    @Body() dto: SetBudgetDto,
  ) {
    return this.budgetsService.upsert(user.userId, category, dto.limit);
  }
}
