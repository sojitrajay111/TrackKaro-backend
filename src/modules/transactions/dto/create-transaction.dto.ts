import {
  IsArray,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

import { CATEGORY_NAMES, CategoryName } from '@/common/constants/categories';
import {
  PAYMENT_METHODS,
  PaymentMethod,
  TRANSACTION_TYPES,
  TransactionType,
} from '../schemas/transaction.schema';

export class CreateTransactionDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  merchant!: string;

  /** Rupees — converted to integer paise at the service boundary. */
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsIn(TRANSACTION_TYPES)
  type!: TransactionType;

  @IsIn(CATEGORY_NAMES)
  category!: CategoryName;

  @IsISO8601({ strict: false })
  date!: string;

  @IsIn(PAYMENT_METHODS)
  paymentMethod!: PaymentMethod;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  people?: string[];

  @IsOptional()
  @IsString()
  notes?: string;
}
