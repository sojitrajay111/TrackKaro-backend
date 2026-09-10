import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model } from 'mongoose';

import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import {
  Transaction,
  TransactionDocument,
  TransactionSchema,
} from '@/modules/transactions/schemas/transaction.schema';
import { BudgetsService } from './budgets.service';
import { CategoryBudget, CategoryBudgetSchema } from './schemas/category-budget.schema';

describe('BudgetsService.checkThreshold', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let budgetsService: BudgetsService;
  let notificationsService: NotificationsService;
  let transactionModel: Model<TransactionDocument>;

  // Each test uses its own fake ObjectId so notifications/transactions from one test can't
  // leak into another's assertions without needing to wipe shared collections between tests.
  let nextUserId = 1;
  const freshUserId = () => String(nextUserId++).padStart(24, '0');

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();

    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: CategoryBudget.name, schema: CategoryBudgetSchema },
          { name: Transaction.name, schema: TransactionSchema },
        ]),
        NotificationsModule,
      ],
      providers: [BudgetsService],
    }).compile();

    budgetsService = moduleRef.get(BudgetsService);
    notificationsService = moduleRef.get(NotificationsService);
    transactionModel = moduleRef.get(getModelToken(Transaction.name));
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  it('does nothing when no budget is set for the category', async () => {
    const userId = freshUserId();
    await budgetsService.checkThreshold(userId, 'Food', 100_00);
    expect(await notificationsService.findAll(userId)).toHaveLength(0);
  });

  it('does nothing under 80% of the limit', async () => {
    const userId = freshUserId();
    await budgetsService.upsert(userId, 'Food', 1000); // ₹1000 limit
    await budgetsService.checkThreshold(userId, 'Food', 500_00); // ₹500 spent — 50%
    expect(await notificationsService.findAll(userId)).toHaveLength(0);
  });

  it('fires a near-limit alert at 80%-99% of the budget', async () => {
    const userId = freshUserId();
    await budgetsService.upsert(userId, 'Shopping', 1000); // ₹1000 limit
    await budgetsService.checkThreshold(userId, 'Shopping', 850_00); // ₹850 — 85%

    const notifications = await notificationsService.findAll(userId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('Budget Alert');
    expect(notifications[0].title).not.toContain('Exceeded');
  });

  it('fires an exceeded alert at 100%+ of the budget, accounting for prior spend', async () => {
    const userId = freshUserId();
    await budgetsService.upsert(userId, 'Travel', 1000); // ₹1000 limit

    // Simulate ₹700 already spent in this category from earlier transactions.
    await transactionModel.create({
      userId,
      title: 'Flight',
      merchant: 'IndiGo',
      amountMinor: 700_00,
      type: 'expense',
      category: 'Travel',
      date: '2026-01-01',
      paymentMethod: 'UPI',
    });

    // Adding ₹400 more pushes total to ₹1100 — over the ₹1000 limit.
    await budgetsService.checkThreshold(userId, 'Travel', 400_00);

    const notifications = await notificationsService.findAll(userId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toContain('Exceeded');
  });

  it('never fires when the limit is 0 (budget effectively disabled)', async () => {
    const userId = freshUserId();
    await budgetsService.upsert(userId, 'Health', 0);
    await budgetsService.checkThreshold(userId, 'Health', 10_000_00);
    expect(await notificationsService.findAll(userId)).toHaveLength(0);
  });
});
