import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { GroupsModule } from './groups.module';
import { GroupsService } from './groups.service';

/**
 * End-to-end through GroupsService + a real (in-memory) MongoDB: expenses added via the same
 * path the API uses, then balances read in both "Simplify debts" modes.
 */
describe('GroupsService — Simplify debts ON / OFF', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let groups: GroupsService;
  let nextUser = 1;
  const freshUser = () => String(nextUser++).padStart(24, '0');

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongod.getUri()), GroupsModule],
    }).compile();
    groups = moduleRef.get(GroupsService);
  }, 60_000);

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  /** "You" is Jay (the owner); Varshik and Vivek are members. */
  async function jayGroup(userId: string) {
    const g = await groups.create(userId, {
      name: 'Weekend',
      category: 'Other',
      members: [{ name: 'You' }, { name: 'Varshik' }, { name: 'Vivek' }],
    });
    const date = '2026-10-20';
    await groups.addExpense(userId, g.id, {
      title: 'Dinner',
      totalAmount: 150,
      paidBy: 'You',
      date,
      splitType: 'equal',
      splits: [
        { memberName: 'You', amount: 50 },
        { memberName: 'Varshik', amount: 50 },
        { memberName: 'Vivek', amount: 50 },
      ],
    });
    await groups.addExpense(userId, g.id, {
      title: 'Snacks',
      totalAmount: 40,
      paidBy: 'Varshik',
      date,
      splitType: 'equal',
      splits: [
        { memberName: 'You', amount: 20 },
        { memberName: 'Varshik', amount: 20 },
      ],
    });
    await groups.addExpense(userId, g.id, {
      title: 'Cab',
      totalAmount: 60,
      paidBy: 'Varshik',
      date,
      splitType: 'equal',
      splits: [
        { memberName: 'Vivek', amount: 30 },
        { memberName: 'Varshik', amount: 30 },
      ],
    });
    return g;
  }

  it('new groups simplify debts by default', async () => {
    const user = freshUser();
    const g = await jayGroup(user);
    expect(g.simplifyDebts).toBe(true);
    const b = await groups.getBalances(user, g.id);
    expect(b.simplified).toBe(true);
    expect(b.totalGroupSpendMinor).toBe(250_00);
    expect(b.members).toEqual([
      { name: 'You', netMinor: 80_00 },
      { name: 'Varshik', netMinor: 0 },
      { name: 'Vivek', netMinor: -80_00 },
    ]);
    expect(b.settlements).toEqual([{ from: 'Vivek', to: 'You', amountMinor: 80_00 }]);
  });

  it('turning simplify OFF shows pairwise debts; balances themselves do not change', async () => {
    const user = freshUser();
    const g = await jayGroup(user);
    const updated = await groups.update(user, g.id, { simplifyDebts: false });
    expect(updated.simplifyDebts).toBe(false);
    const b = await groups.getBalances(user, g.id);
    expect(b.simplified).toBe(false);
    expect(b.members.find((m) => m.name === 'You')?.netMinor).toBe(80_00);
    expect(b.settlements).toEqual([
      { from: 'Varshik', to: 'You', amountMinor: 30_00 },
      { from: 'Vivek', to: 'Varshik', amountMinor: 30_00 },
      { from: 'Vivek', to: 'You', amountMinor: 50_00 },
    ]);
  });

  it('switching back ON restores the single payment', async () => {
    const user = freshUser();
    const g = await jayGroup(user);
    await groups.update(user, g.id, { simplifyDebts: false });
    await groups.update(user, g.id, { simplifyDebts: true });
    const b = await groups.getBalances(user, g.id);
    expect(b.settlements).toEqual([{ from: 'Vivek', to: 'You', amountMinor: 80_00 }]);
  });

  it('a recorded settle-up is reflected in both modes and is not counted as spending', async () => {
    const user = freshUser();
    const g = await jayGroup(user);
    await groups.recordSettlement(user, g.id, { fromMember: 'Vivek', toMember: 'You', amount: 50 });

    const on = await groups.getBalances(user, g.id);
    expect(on.totalGroupSpendMinor).toBe(250_00);
    expect(on.settlements).toEqual([{ from: 'Vivek', to: 'You', amountMinor: 30_00 }]);

    await groups.update(user, g.id, { simplifyDebts: false });
    const off = await groups.getBalances(user, g.id);
    expect(off.settlements).toEqual([
      { from: 'Varshik', to: 'You', amountMinor: 30_00 },
      { from: 'Vivek', to: 'Varshik', amountMinor: 30_00 },
    ]);
  });

  it('fully settled groups show no payments in either mode', async () => {
    const user = freshUser();
    const g = await jayGroup(user);
    await groups.recordSettlement(user, g.id, { fromMember: 'Vivek', toMember: 'You', amount: 80 });
    expect((await groups.getBalances(user, g.id)).settlements).toEqual([]);
    await groups.update(user, g.id, { simplifyDebts: false });
    const off = await groups.getBalances(user, g.id);
    // Pairwise still lists Varshik's debts to Jay and Vivek's to Varshik, which net to zero
    // per person but not per pair — Splitwise behaves the same way.
    const left = new Map<string, number>();
    for (const s of off.settlements) {
      left.set(s.from, (left.get(s.from) ?? 0) - s.amountMinor);
      left.set(s.to, (left.get(s.to) ?? 0) + s.amountMinor);
    }
    for (const m of off.members) expect(m.netMinor - (left.get(m.name) ?? 0)).toBe(0);
  });

  it('only the owner can change the setting', async () => {
    const owner = freshUser();
    const stranger = freshUser();
    const g = await jayGroup(owner);
    await expect(groups.update(stranger, g.id, { simplifyDebts: false })).rejects.toThrow();
  });
});
