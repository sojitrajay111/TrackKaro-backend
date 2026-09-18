import { IsNumber, Max, Min } from 'class-validator';

export class SetBudgetDto {
  /** Rupees — converted to integer paise at the service boundary. */
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  limit!: number;
}
