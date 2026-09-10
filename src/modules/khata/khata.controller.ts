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
import { CreateKhataEntryDto } from './dto/create-khata-entry.dto';
import { SettleAllDto } from './dto/settle-all.dto';
import { KhataService } from './khata.service';

@Controller('khata')
export class KhataController {
  constructor(private readonly khataService: KhataService) {}

  @Get()
  findAll(@CurrentUser() user: CurrentUserPayload) {
    return this.khataService.findAll(user.userId);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateKhataEntryDto) {
    return this.khataService.create(user.userId, dto);
  }

  @Patch(':id/toggle')
  toggleStatus(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    return this.khataService.toggleStatus(user.userId, id);
  }

  @Post('settle-all')
  @HttpCode(HttpStatus.OK)
  settleAll(@CurrentUser() user: CurrentUserPayload, @Body() dto: SettleAllDto) {
    return this.khataService.settleAllForPerson(user.userId, dto.personName);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    await this.khataService.remove(user.userId, id);
  }
}
