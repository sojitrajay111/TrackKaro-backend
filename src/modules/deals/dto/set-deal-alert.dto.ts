import { IsBoolean, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class SetDealAlertDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  targetPrice?: number;
}
