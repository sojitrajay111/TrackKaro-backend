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

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(GROUP_CATEGORIES)
  category?: GroupCategory;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GroupMemberInputDto)
  members?: GroupMemberInputDto[];
}
