import { PartialType } from '@nestjs/mapped-types';
import { IsIn, IsOptional } from 'class-validator';

import { CreateReminderDto } from './create-reminder.dto';
import { REMINDER_STATUSES, ReminderStatus } from '../schemas/bill-reminder.schema';

export class UpdateReminderDto extends PartialType(CreateReminderDto) {
  @IsOptional()
  @IsIn(REMINDER_STATUSES)
  status?: ReminderStatus;
}
