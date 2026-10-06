import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { PlannerTask, PlannerTaskSchema } from './schemas/task.schema';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: PlannerTask.name, schema: PlannerTaskSchema }])],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
