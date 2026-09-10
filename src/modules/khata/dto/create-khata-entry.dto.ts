import { IsIn, IsISO8601, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

import { KHATA_TYPES, KhataType } from '../schemas/khata-entry.schema';

export class CreateKhataEntryDto {
  @IsString()
  @MinLength(1)
  personName!: string;

  @IsOptional()
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
  @IsISO8601({ strict: false })
  dueDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
