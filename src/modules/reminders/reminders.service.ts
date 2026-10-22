import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { toMajorUnits, toMinorUnits } from '@/common/money/money.util';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import {
  BillReminder,
  BillReminderDocument,
  ReminderFrequency,
} from './schemas/bill-reminder.schema';

export interface PublicReminderPayment {
  /** The due date this payment settled (YYYY-MM-DD). */
  dueDate: string;
  paidAt: string;
  amount: number;
}

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
  /** Settled occurrences of a recurring bill, oldest first. */
  payments: PublicReminderPayment[];
}

export interface ReminderStats {
  /** Percentage of paid bills settled on/before their due date, or null with too little
   * history (fewer than 3 paid bills) to make the figure meaningful. */
  onTimeRate: number | null;
}

const PERIOD_MONTHS: Record<Exclude<ReminderFrequency, 'One-time'>, number> = {
  Monthly: 1,
  Quarterly: 3,
  Yearly: 12,
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const parseYmd = (s: string) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const addDays = (s: string, days: number) => {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
};
const daysBetween = (from: string, to: string) =>
  Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000);

/** Move a date forward by whole months, pinned to `anchorDay` but clamped to the month's
 * length — so a bill due on the 31st falls on Feb 28 and returns to Mar 31, without drifting. */
function addMonths(s: string, months: number, anchorDay: number): string {
  const d = parseYmd(s);
  const total = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return ymd(new Date(Date.UTC(year, month, Math.min(anchorDay, daysInMonth))));
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

  /**
   * Field edits plus status changes. Marking a *recurring* pending bill paid doesn't leave it
   * 'paid': the payment is recorded in `payments` and the bill rolls on to its next due date
   * (alert date keeps the same lead time), pending again. One-time bills just flip status.
   */
  async update(userId: string, id: string, dto: UpdateReminderDto): Promise<PublicReminder> {
    const doc = await this.reminderModel.findOne({ _id: id, userId }).exec();
    if (!doc) throw new NotFoundException('Reminder not found');

    const { status, amount, ...fields } = dto;
    Object.assign(doc, fields);
    if (amount !== undefined) doc.amountMinor = toMinorUnits(amount);

    if (status && status !== doc.status) {
      if (status === 'paid' && doc.frequency !== 'One-time') {
        this.rollForward(doc);
      } else {
        doc.status = status;
        // Record (or clear) the moment it was actually settled — the only way to later tell
        // whether it was paid on time, since dueDate/reminderDate don't capture that.
        doc.paidAt = status === 'paid' ? new Date() : undefined;
      }
    }

    await doc.save();
    return this.toPublic(doc);
  }

  /** Reverse the most recent payment: a recurring bill goes back to the period it settled;
   * a paid one-time (or legacy) bill goes back to pending. */
  async undoPayment(userId: string, id: string): Promise<PublicReminder> {
    const doc = await this.reminderModel.findOne({ _id: id, userId }).exec();
    if (!doc) throw new NotFoundException('Reminder not found');

    const last = doc.payments.at(-1);
    if (doc.status === 'paid') {
      doc.status = 'pending';
      doc.paidAt = undefined;
    } else if (last) {
      doc.payments.pop();
      doc.dueDate = last.dueDate;
      doc.reminderDate = last.reminderDate;
      doc.paidAt = doc.payments.at(-1)?.paidAt;
    } else {
      throw new BadRequestException('This bill has no payment to undo.');
    }

    await doc.save();
    return this.toPublic(doc);
  }

  private rollForward(doc: BillReminderDocument): void {
    const months = PERIOD_MONTHS[doc.frequency as keyof typeof PERIOD_MONTHS];
    const now = new Date();
    // Anchor on the first recorded due date so month-end clamping (31st → 28th) doesn't stick.
    const anchorDay = parseYmd(doc.payments[0]?.dueDate ?? doc.dueDate).getUTCDate();
    const lead = Math.max(0, daysBetween(doc.reminderDate, doc.dueDate));

    doc.payments.push({
      dueDate: doc.dueDate.slice(0, 10),
      reminderDate: doc.reminderDate.slice(0, 10),
      paidAt: now,
      amountMinor: doc.amountMinor,
    });
    const nextDue = addMonths(doc.dueDate, months, anchorDay);
    doc.dueDate = nextDue;
    doc.reminderDate = addDays(nextDue, -lead);
    doc.status = 'pending';
    doc.paidAt = now;
  }

  private static readonly MIN_PAID_FOR_RATE = 3;

  async getStats(userId: string): Promise<ReminderStats> {
    const docs = await this.reminderModel
      .find({
        userId,
        $or: [{ status: 'paid', paidAt: { $exists: true } }, { 'payments.0': { $exists: true } }],
      })
      .exec();

    // Every settled occurrence: recurring payments from history, plus paid one-time bills.
    const settled: { paidAt: Date; dueDate: string }[] = [];
    for (const r of docs) {
      for (const p of r.payments) settled.push({ paidAt: p.paidAt, dueDate: p.dueDate });
      if (r.status === 'paid' && r.paidAt) settled.push({ paidAt: r.paidAt, dueDate: r.dueDate });
    }
    if (settled.length < RemindersService.MIN_PAID_FOR_RATE) {
      return { onTimeRate: null };
    }

    // Compare calendar dates (YYYY-MM-DD) rather than exact timestamps — dueDate has no time
    // component, so paying at 11pm on the due date must still count as on time.
    const onTime = settled.filter((s) => ymd(s.paidAt) <= s.dueDate.slice(0, 10)).length;
    return { onTimeRate: Math.round((onTime / settled.length) * 100) };
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
      payments: (doc.payments ?? []).map((p) => ({
        dueDate: p.dueDate,
        paidAt: p.paidAt.toISOString(),
        amount: toMajorUnits(p.amountMinor),
      })),
    };
  }
}
