import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { BillReminder, BillReminderDocument } from './schemas/bill-reminder.schema';

export interface PublicReminder {
  id: string;
  title: string;
  category: string;
  amount: number;
  dueDate: string;
  reminderDate: string;
  frequency: BillReminder['frequency'];
  status: BillReminder['status'];
  notes?: string;
}

@Injectable()
export class RemindersService {
  constructor(
    @InjectModel(BillReminder.name) private readonly reminderModel: Model<BillReminderDocument>,
  ) {}

  async findAll(userId: string): Promise<PublicReminder[]> {
    const docs = await this.reminderModel.find({ userId }).sort({ dueDate: 1 }).exec();
    return docs.map((doc) => this.toPublic(doc));
  }

  async create(userId: string, dto: CreateReminderDto): Promise<PublicReminder> {
    const doc = await this.reminderModel.create({
      userId,
      title: dto.title,
      category: dto.category,
      amountMinor: toMinorUnits(dto.amount),
      dueDate: dto.dueDate,
      reminderDate: dto.reminderDate,
      frequency: dto.frequency,
      notes: dto.notes,
    });
    return this.toPublic(doc);
  }

  async update(userId: string, id: string, dto: UpdateReminderDto): Promise<PublicReminder> {
    const patch: Record<string, unknown> = { ...dto };
    if (dto.amount !== undefined) {
      patch.amountMinor = toMinorUnits(dto.amount);
      delete patch.amount;
    }

    const doc = await this.reminderModel
      .findOneAndUpdate({ _id: id, userId }, patch, { new: true })
      .exec();
    if (!doc) throw new NotFoundException('Reminder not found');
    return this.toPublic(doc);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.reminderModel.deleteOne({ _id: id, userId }).exec();
    if (result.deletedCount === 0) throw new NotFoundException('Reminder not found');
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.reminderModel.deleteMany({ userId }).exec();
  }

  private toPublic(doc: BillReminderDocument): PublicReminder {
    return {
      id: doc._id.toString(),
      title: doc.title,
      category: doc.category,
      amount: toMajorUnits(doc.amountMinor),
      dueDate: doc.dueDate,
      reminderDate: doc.reminderDate,
      frequency: doc.frequency,
      status: doc.status,
      notes: doc.notes,
    };
  }
}
