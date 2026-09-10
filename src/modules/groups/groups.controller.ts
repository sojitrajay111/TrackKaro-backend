import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { AddGroupExpenseDto } from './dto/add-group-expense.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { RecordSettlementDto } from './dto/record-settlement.dto';
import { GroupsService } from './groups.service';

@Controller('groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.groupsService.findAll(user.userId);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(user.userId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.groupsService.remove(user.userId, id);
  }

  @Post(':id/expenses')
  addExpense(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: AddGroupExpenseDto,
  ) {
    return this.groupsService.addExpense(user.userId, id, dto);
  }

  @Post(':id/settlements')
  recordSettlement(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: RecordSettlementDto,
  ) {
    return this.groupsService.recordSettlement(user.userId, id, dto);
  }

  @Get(':id/balances')
  getBalances(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.groupsService.getBalances(user.userId, id);
  }
}
