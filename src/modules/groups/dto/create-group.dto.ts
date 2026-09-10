import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';

import { GROUP_CATEGORIES, GroupCategory } from '../schemas/expense-group.schema';

class GroupMemberInputDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  phone?: string;
}

export class CreateGroupDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(GROUP_CATEGORIES)
  category!: GroupCategory;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupMemberInputDto)
  members!: GroupMemberInputDto[];
}
