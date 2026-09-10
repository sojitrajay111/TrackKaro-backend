import { IsNumber, IsOptional, Min } from 'class-validator';

export class TrackDealDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPrice?: number;
}
