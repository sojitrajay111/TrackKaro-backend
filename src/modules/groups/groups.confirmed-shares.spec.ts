import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { TransactionsService } from '@/modules/transactions/transactions.service';
import { GroupsModule } from './groups.module';
import { GroupsService } from './groups.service';

/**
 * A share confirmed into personal spending must follow its group expense: edits update it,
 * removing the member or deleting the expense removes it, and it's never offered twice.
 */
describe('GroupsService — confirmed shares follow the group expense', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let groups: GroupsService;
  let transactions: TransactionsService;
  let nextUser = 1;
  const freshUser = () => String(nextUser++).padStart(24, '0');

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongod.getUri()), GroupsModule],
    }).compile();
    groups = moduleRef.get(GroupsService);
    transactions = moduleRef.get(TransactionsService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  /** Owner ("You") splits a ₹600 dinner with Rahul, then confirms their ₹300 share. */
  async function confirmedDinner(userId: string) {
    const g = await groups.create(userId, {
      name: 'Flat',
      category: 'Other',
      members: [{ name: 'You' }, { name: 'Rahul' }],
    });
    const e = await groups.addExpense(userId, g.id, {
      title: 'Dinner',
      totalAmount: 600,
      paidBy: 'Rahul',
      date: '2026-10-20',
      splitType: 'equal',
      splits: [
        { memberName: 'You', amount: 300 },
        { memberName: 'Rahul', amount: 300 },
      ],
    });
    await groups.confirmExpenseSplit(userId, g.id, e.id, { category: 'Food' });
    return { g, e };
  }

  const mine = async (userId: string) =>
    (await transactions.findAll(userId, { limit: 50, page: 1 })).items;

  it('editing the amount updates the confirmed copy and does not offer it again', async () => {
    const user = freshUser();
    const { g, e } = await confirmedDinner(user);

    await groups.updateExpense(user, g.id, e.id, {
      title: 'Team dinner',
      totalAmount: 400,
      splits: [
        { memberName: 'You', amount: 200 },
        { memberName: 'Rahul', amount: 200 },
      ],
    });

    const txs = await mine(user);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ amount: 200, title: 'Team dinner' });
    expect(await groups.getPendingConfirmations(user)).toHaveLength(0);
  });

  it('removing the member from the split removes their confirmed copy', async () => {
    const user = freshUser();
    const { g, e } = await confirmedDinner(user);

    await groups.updateExpense(user, g.id, e.id, {
      totalAmount: 600,
      splits: [{ memberName: 'Rahul', amount: 600 }],
    });

    expect(await mine(user)).toHaveLength(0);
  });

  it('deleting the expense removes the confirmed copy', async () => {
    const user = freshUser();
    const { g, e } = await confirmedDinner(user);

    await groups.deleteExpense(user, g.id, e.id);

    expect(await mine(user)).toHaveLength(0);
  });
});
