import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { GROUP_SPLIT_TYPES, GroupSplitType } from '../schemas/group-expense.schema';

class GroupSplitInputDto {
  @IsString()
  @MinLength(1)
  memberName!: string;

  /** Rupees — converted to integer paise at the service boundary. */
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  amount!: number;
}

export class AddGroupExpenseDto {
  @IsString()
  @MinLength(1)
  title!: string;

  /** Rupees — converted to integer paise at the service boundary. */
  @IsNumber()
  @Min(0)
  @Max(100_000_000)
  totalAmount!: number;

  @IsString()
  @MinLength(1)
  paidBy!: string;

  @IsISO8601({ strict: false })
  date!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupSplitInputDto)
  splits!: GroupSplitInputDto[];

  @IsOptional()
  @IsIn(GROUP_SPLIT_TYPES)
  splitType?: GroupSplitType;

  @IsOptional()
  @IsString()
  notes?: string;
}
