import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { RemindersService } from './reminders.service';
import { BillReminder, BillReminderSchema } from './schemas/bill-reminder.schema';

describe('RemindersService recurring payments', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let service: RemindersService;

  let nextUserId = 1;
  const freshUserId = () => String(nextUserId++).padStart(24, '0');

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([{ name: BillReminder.name, schema: BillReminderSchema }]),
      ],
      providers: [RemindersService],
    }).compile();
    service = moduleRef.get(RemindersService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  const bill = (userId: string, over: Partial<Parameters<RemindersService['create']>[1]> = {}) =>
    service.create(userId, {
      title: 'Credit card bill',
      category: 'Bills',
      amount: 1425,
      dueDate: '2026-10-29',
      reminderDate: '2026-10-26',
      frequency: 'Monthly',
      ...over,
    });

  it('marking a monthly bill paid records the payment and rolls to next month', async () => {
    const userId = freshUserId();
    const r = await bill(userId);
    const after = await service.update(userId, r.id, { status: 'paid' });

    expect(after.status).toBe('pending');
    expect(after.dueDate).toBe('2026-11-29');
    expect(after.reminderDate).toBe('2026-11-26'); // same 3-day lead
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({ dueDate: '2026-10-29', amount: 1425 });
  });

  it('quarterly and yearly advance by 3 and 12 months', async () => {
    const userId = freshUserId();
    const q = await bill(userId, { frequency: 'Quarterly' });
    const y = await bill(userId, { frequency: 'Yearly' });
    expect((await service.update(userId, q.id, { status: 'paid' })).dueDate).toBe('2027-01-29');
    expect((await service.update(userId, y.id, { status: 'paid' })).dueDate).toBe('2027-10-29');
  });

  it('month-end due dates clamp without drifting', async () => {
    const userId = freshUserId();
    const r = await bill(userId, { dueDate: '2027-01-31', reminderDate: '2027-01-28' });
    const feb = await service.update(userId, r.id, { status: 'paid' });
    expect(feb.dueDate).toBe('2027-02-28');
    const mar = await service.update(userId, r.id, { status: 'paid' });
    expect(mar.dueDate).toBe('2027-03-31');
  });

  it('undo restores the settled period exactly', async () => {
    const userId = freshUserId();
    const r = await bill(userId);
    await service.update(userId, r.id, { status: 'paid' });
    const undone = await service.undoPayment(userId, r.id);
    expect(undone).toMatchObject({ status: 'pending', dueDate: '2026-10-29', reminderDate: '2026-10-26', payments: [] });
    await expect(service.undoPayment(userId, r.id)).rejects.toThrow('no payment to undo');
  });

  it('one-time bills just flip to paid and back', async () => {
    const userId = freshUserId();
    const r = await bill(userId, { frequency: 'One-time' });
    const paid = await service.update(userId, r.id, { status: 'paid' });
    expect(paid).toMatchObject({ status: 'paid', dueDate: '2026-10-29', payments: [] });
    expect((await service.undoPayment(userId, r.id)).status).toBe('pending');
  });

  it('on-time rate counts each recurring payment', async () => {
    const userId = freshUserId();
    const r = await bill(userId, { dueDate: '2099-01-10', reminderDate: '2099-01-07' });
    for (let i = 0; i < 3; i++) await service.update(userId, r.id, { status: 'paid' });
    expect((await service.getStats(userId)).onTimeRate).toBe(100);
  });
});
