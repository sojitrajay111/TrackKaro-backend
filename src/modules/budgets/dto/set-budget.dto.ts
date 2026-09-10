import { IsNumber, Min } from 'class-validator';

export class SetBudgetDto {
  /** Rupees — converted to integer paise at the service boundary. */
  @IsNumber()
  @Min(0)
  limit!: number;
}
