import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CurrentUser, CurrentUserPayload } from '@/common/decorators/current-user.decorator';
import { ParseObjectIdPipe } from '@/common/pipes/parse-object-id.pipe';
import { CreateTaskDto } from './dto/create-task.dto';
import { QueryTasksDto } from './dto/query-tasks.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  findInRange(@CurrentUser() user: CurrentUserPayload, @Query() query: QueryTasksDto) {
    return this.tasksService.findInRange(user.userId, query.from, query.to);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateTaskDto) {
    return this.tasksService.create(user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseObjectIdPipe) id: string,
  ) {
    await this.tasksService.remove(user.userId, id);
  }
}
