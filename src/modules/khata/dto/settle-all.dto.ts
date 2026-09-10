import { IsString, MinLength } from 'class-validator';

export class SettleAllDto {
  @IsString()
  @MinLength(1)
  personName!: string;
}
