import { IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class RecordSettlementDto {
  @IsString()
  @MinLength(1)
  fromMember!: string;

  @IsString()
  @MinLength(1)
  toMember!: string;

  /** Rupees — converted to integer paise at the service boundary. */
  @IsNumber()
  @Min(0.01)
  @Max(100_000_000)
  amount!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
