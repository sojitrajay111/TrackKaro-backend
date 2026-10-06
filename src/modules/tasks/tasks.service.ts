import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { PlannerTask, TaskDocument } from './schemas/task.schema';

export interface PublicTask {
  id: string;
  title: string;
  notes?: string;
  dueDate: string;
  dueTime?: string;
  status: PlannerTask['status'];
  priority: PlannerTask['priority'];
}

@Injectable()
export class TasksService {
  constructor(
    @InjectModel(PlannerTask.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  async findInRange(userId: string, from: string, to: string): Promise<PublicTask[]> {
    const docs = await this.taskModel
      .find({ userId, dueDate: { $gte: from, $lte: to } })
      .sort({ dueDate: 1, status: 1 })
      .exec();
    return docs.map((doc) => this.toPublic(doc));
  }

  async create(userId: string, dto: CreateTaskDto): Promise<PublicTask> {
    const doc = await this.taskModel.create({
      userId,
      title: dto.title.trim(),
      dueDate: dto.dueDate,
      notes: dto.notes?.trim(),
      dueTime: dto.dueTime,
      priority: dto.priority ?? 'medium',
      status: 'todo',
    });
    return this.toPublic(doc);
  }

  async update(userId: string, id: string, dto: UpdateTaskDto): Promise<PublicTask> {
    const patch: Record<string, unknown> = { ...dto };
    if (dto.title !== undefined) patch.title = dto.title.trim();
    if (dto.notes !== undefined) patch.notes = dto.notes.trim() || undefined;

    if (dto.status) {
      const existing = await this.taskModel.findOne({ _id: id, userId }).exec();
      if (existing && existing.status !== dto.status) {
        patch.completedAt = dto.status === 'done' ? new Date() : undefined;
      }
    }

    const doc = await this.taskModel
      .findOneAndUpdate({ _id: id, userId }, patch, { new: true })
      .exec();
    if (!doc) throw new NotFoundException('Task not found');
    return this.toPublic(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.taskModel.deleteOne({ _id: id, userId }).exec();
    if (result.deletedCount === 0) throw new NotFoundException('Task not found');
  }

  private toPublic(doc: TaskDocument): PublicTask {
    return {
      id: String(doc._id),
      title: doc.title,
      notes: doc.notes,
      dueDate: doc.dueDate,
      dueTime: doc.dueTime,
      status: doc.status,
      priority: doc.priority,
    };
  }
}
