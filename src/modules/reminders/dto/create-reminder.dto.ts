import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

import { CATEGORY_NAMES, CategoryName } from '@/common/constants/categories';
import { REMINDER_FREQUENCIES, ReminderFrequency } from '../schemas/bill-reminder.schema';

export class CreateReminderDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsIn(CATEGORY_NAMES)
  category!: CategoryName;

  /** Rupees — converted to integer paise at the service boundary. */
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsISO8601({ strict: false })
  dueDate!: string;

  @IsISO8601({ strict: false })
  reminderDate!: string;

  @IsIn(REMINDER_FREQUENCIES)
  frequency!: ReminderFrequency;

  @IsOptional()
  @IsString()
  notes?: string;
}
