import { IsIn, IsISO8601, IsOptional, IsString, Matches, MinLength } from 'class-validator';

import { TASK_PRIORITIES, TaskPriority } from '../schemas/task.schema';

export class CreateTaskDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsISO8601({ strict: false })
  dueDate!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  dueTime?: string;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;
}
