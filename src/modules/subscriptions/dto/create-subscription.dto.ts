import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

import { CATEGORY_NAMES, CategoryName } from '@/common/constants/categories';
import { BILLING_CYCLES, BillingCycle } from '../schemas/subscription.schema';

export class CreateSubscriptionDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(CATEGORY_NAMES)
  category!: CategoryName;

  /** Rupees — converted to integer paise at the service boundary. */
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsIn(BILLING_CYCLES)
  billingCycle!: BillingCycle;

  @IsISO8601({ strict: false })
  nextBillingDate!: string;

  @IsString()
  icon!: string;

  @IsOptional()
  @IsBoolean()
  isRedundant?: boolean;

  @IsOptional()
  @IsString()
  redundancyReason?: string;
}
