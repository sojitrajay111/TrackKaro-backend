import { IsIn } from 'class-validator';

import { CATEGORY_NAMES, CategoryName } from '@/common/constants/categories';

export class ConfirmGroupExpenseDto {
  @IsIn(CATEGORY_NAMES)
  category!: CategoryName;
}
