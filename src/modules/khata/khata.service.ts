import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { escapeRegExp } from '@/common/utils/regex.util';
import { CreateKhataEntryDto } from './dto/create-khata-entry.dto';
import { KhataEntry, KhataEntryDocument } from './schemas/khata-entry.schema';

export interface PublicKhataEntry {
  id: string;
  personName: string;
  phone?: string;
  amount: number;
  type: KhataEntry['type'];
  date: string;
  dueDate?: string;
  notes?: string;
  status: KhataEntry['status'];
}

@Injectable()
export class KhataService {
  constructor(
    @InjectModel(KhataEntry.name) private readonly khataModel: Model<KhataEntryDocument>,
  ) {}

  async findAll(userId: string): Promise<PublicKhataEntry[]> {
    const docs = await this.khataModel.find({ userId }).sort({ createdAt: -1 }).exec();
    return docs.map((doc) => this.toPublic(doc));
  }

  async create(userId: string, dto: CreateKhataEntryDto): Promise<PublicKhataEntry> {
    const doc = await this.khataModel.create({
      userId,
      personName: dto.personName,
      phone: dto.phone,
      amountMinor: toMinorUnits(dto.amount),
      type: dto.type,
      date: dto.date,
      dueDate: dto.dueDate,
      notes: dto.notes,
      status: 'pending',
    });
    return this.toPublic(doc);
  }

  async toggleStatus(userId: string, id: string): Promise<PublicKhataEntry> {
    const existing = await this.khataModel.findOne({ _id: id, userId }).exec();
    if (!existing) throw new NotFoundException('Khata entry not found');

    existing.status = existing.status === 'pending' ? 'settled' : 'pending';
    await existing.save();
    return this.toPublic(existing);
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.khataModel.deleteOne({ _id: id, userId }).exec();
    if (result.deletedCount === 0) throw new NotFoundException('Khata entry not found');
  }

  async deleteAllForUser(userId: string): Promise<void> {
    await this.khataModel.deleteMany({ userId }).exec();
  }

  async settleAllForPerson(userId: string, personName: string): Promise<void> {
    const exactMatch = new RegExp(`^${escapeRegExp(personName.trim())}$`, 'i');
    await this.khataModel
      .updateMany({ userId, personName: exactMatch }, { status: 'settled' })
      .exec();
  }

  private toPublic(doc: KhataEntryDocument): PublicKhataEntry {
    return {
      id: doc._id.toString(),
      personName: doc.personName,
      phone: doc.phone,
      amount: toMajorUnits(doc.amountMinor),
      type: doc.type,
      date: doc.date,
      dueDate: doc.dueDate,
      notes: doc.notes,
      status: doc.status,
    };
  }
}
