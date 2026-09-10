import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

import { KHATA_STATUSES, KHATA_TYPES, KhataStatus, KhataType } from '../schemas/khata-entry.schema';

export class CreateKhataEntryDto {
  @IsString()
  @MinLength(1)
  personName!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  phone?: string;

  /** Rupees — converted to integer paise at the service boundary. */
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsIn(KHATA_TYPES)
  type!: KhataType;

  @IsISO8601({ strict: false })
  date!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsISO8601({ strict: false })
  dueDate?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(KHATA_STATUSES)
  status?: KhataStatus;
}
