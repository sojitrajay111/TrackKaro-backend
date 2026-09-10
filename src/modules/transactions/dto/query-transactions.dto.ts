import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsInt, IsOptional, Max, Min } from 'class-validator';

import { CATEGORY_NAMES, CategoryName } from '@/common/constants/categories';
import { TRANSACTION_TYPES, TransactionType } from '../schemas/transaction.schema';

export class QueryTransactionsDto {
  @IsOptional()
  @IsIn(CATEGORY_NAMES)
  category?: CategoryName;

  @IsOptional()
  @IsIn(TRANSACTION_TYPES)
  type?: TransactionType;

  @IsOptional()
  @IsISO8601({ strict: false })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: false })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit: number = 50;
}
