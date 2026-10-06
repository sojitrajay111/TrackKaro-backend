import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type TaskDocument = HydratedDocument<PlannerTask>;

export const TASK_STATUSES = ['todo', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

@Schema({ timestamps: true })
export class PlannerTask {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ trim: true })
  notes?: string;

  @Prop({ required: true })
  dueDate!: string;

  @Prop()
  dueTime?: string;

  @Prop({ required: true, enum: TASK_STATUSES, default: 'todo' })
  status!: TaskStatus;

  @Prop({ required: true, enum: TASK_PRIORITIES, default: 'medium' })
  priority!: TaskPriority;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'BillReminder' })
  linkedReminderId?: Types.ObjectId;

  @Prop()
  completedAt?: Date;
}

export const PlannerTaskSchema = SchemaFactory.createForClass(PlannerTask);

PlannerTaskSchema.index({ userId: 1, dueDate: 1, status: 1 });
