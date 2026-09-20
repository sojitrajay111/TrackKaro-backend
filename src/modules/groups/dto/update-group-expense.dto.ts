import { PartialType } from '@nestjs/mapped-types';
import { AddGroupExpenseDto } from './add-group-expense.dto';

export class UpdateGroupExpenseDto extends PartialType(AddGroupExpenseDto) {}
