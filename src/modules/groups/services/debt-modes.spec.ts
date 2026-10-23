import {
  DebtSimplificationService,
  MemberBalance,
  PairwiseExpense,
  SimplifiedSettlement,
} from './debt-simplification.service';

/**
 * "Simplify debts" ON vs OFF. Both modes must describe the same money: after everyone makes
 * the listed payments, every member's balance is exactly zero. These tests pin real scenarios
 * and then fuzz hundreds of random groups for that invariant.
 */
const service = new DebtSimplificationService();

/** Net balance per member, exactly as GroupsService.getBalances computes it (paid − shares). */
function balancesOf(expenses: PairwiseExpense[], members: string[]): MemberBalance[] {
  const net = new Map(members.map((m) => [m, 0]));
  for (const e of expenses) {
    net.set(e.paidBy, (net.get(e.paidBy) ?? 0) + e.splits.reduce((s, x) => s + x.amountMinor, 0));
    for (const s of e.splits) net.set(s.memberName, (net.get(s.memberName) ?? 0) - s.amountMinor);
  }
  return [...net].map(([name, netMinor]) => ({ name, netMinor }));
}

/** Balances left after everyone pays what the settlements say. Must all be 0. */
function afterPaying(balances: MemberBalance[], settlements: SimplifiedSettlement[]) {
  const left = new Map(balances.map((b) => [b.name, b.netMinor]));
  for (const s of settlements) {
    left.set(s.from, (left.get(s.from) ?? 0) + s.amountMinor); // debtor pays → less negative
    left.set(s.to, (left.get(s.to) ?? 0) - s.amountMinor); // creditor receives → less positive
  }
  return [...left.values()];
}

const exp = (paidBy: string, splits: Record<string, number>): PairwiseExpense => ({
  paidBy,
  splits: Object.entries(splits).map(([memberName, rupees]) => ({
    memberName,
    amountMinor: Math.round(rupees * 100),
  })),
});

describe('Simplify debts ON vs OFF', () => {
  // Jay paid 150 for all three; Varshik paid 40 (Jay & Varshik) and 60 (Vivek & Varshik).
  const jayGroup = [
    exp('Jay', { Jay: 50, Varshik: 50, Vivek: 50 }),
    exp('Varshik', { Jay: 20, Varshik: 20 }),
    exp('Varshik', { Vivek: 30, Varshik: 30 }),
  ];
  const jayMembers = ['Jay', 'Varshik', 'Vivek'];

  it('Jay / Varshik / Vivek: balances are +80 / 0 / −80', () => {
    expect(balancesOf(jayGroup, jayMembers)).toEqual([
      { name: 'Jay', netMinor: 80_00 },
      { name: 'Varshik', netMinor: 0 },
      { name: 'Vivek', netMinor: -80_00 },
    ]);
  });

  it('Jay / Varshik / Vivek, simplify ON: one payment, Vivek → Jay ₹80', () => {
    expect(service.simplify(balancesOf(jayGroup, jayMembers))).toEqual([
      { from: 'Vivek', to: 'Jay', amountMinor: 80_00 },
    ]);
  });

  it('Jay / Varshik / Vivek, simplify OFF: pairwise Varshik→Jay 30, Vivek→Jay 50, Vivek→Varshik 30', () => {
    expect(service.pairwise(jayGroup)).toEqual([
      { from: 'Varshik', to: 'Jay', amountMinor: 30_00 },
      { from: 'Vivek', to: 'Jay', amountMinor: 50_00 },
      { from: 'Vivek', to: 'Varshik', amountMinor: 30_00 },
    ]);
  });

  it('both modes leave everyone at exactly zero for the Jay group', () => {
    const b = balancesOf(jayGroup, jayMembers);
    expect(afterPaying(b, service.simplify(b)).every((x) => x === 0)).toBe(true);
    expect(afterPaying(b, service.pairwise(jayGroup)).every((x) => x === 0)).toBe(true);
  });

  it('a settle-up (stored as paid by debtor, split to creditor) reduces the pairwise debt', () => {
    // Vivek pays Jay ₹50: now only Varshik→Jay 30 and Vivek→Varshik 30 remain.
    const withSettle = [...jayGroup, exp('Vivek', { Jay: 50 })];
    expect(service.pairwise(withSettle)).toEqual([
      { from: 'Varshik', to: 'Jay', amountMinor: 30_00 },
      { from: 'Vivek', to: 'Varshik', amountMinor: 30_00 },
    ]);
    // Simplified: Vivek still owes 30 in total, which goes to Jay.
    expect(service.simplify(balancesOf(withSettle, jayMembers))).toEqual([
      { from: 'Vivek', to: 'Jay', amountMinor: 30_00 },
    ]);
  });

  it('Goa trip (4 people, uneven ₹912.50 shares, partial settle-up) matches the hand calculation', () => {
    const goa = [
      exp('You', { You: 4500, Rahul: 4500, Priya: 4500, Neha: 4500 }),
      exp('Rahul', { You: 600, Rahul: 600, Priya: 600, Neha: 600 }),
      exp('Priya', { You: 912.5, Rahul: 912.5, Priya: 912.5, Neha: 912.5 }),
      exp('Neha', { You: 1000, Neha: 1000 }),
      exp('Neha', { You: 3000 }), // settle-up Neha → You
    ];
    const members = ['You', 'Rahul', 'Priya', 'Neha'];
    const b = balancesOf(goa, members);
    expect(b).toEqual([
      { name: 'You', netMinor: 7987_50 },
      { name: 'Rahul', netMinor: -3612_50 },
      { name: 'Priya', netMinor: -2362_50 },
      { name: 'Neha', netMinor: -2012_50 },
    ]);
    expect(service.simplify(b)).toEqual([
      { from: 'Rahul', to: 'You', amountMinor: 3612_50 },
      { from: 'Priya', to: 'You', amountMinor: 2362_50 },
      { from: 'Neha', to: 'You', amountMinor: 2012_50 },
    ]);
    const pw = service.pairwise(goa);
    expect(afterPaying(b, pw).every((x) => x === 0)).toBe(true);
    // Pairwise keeps the debts between non-payers too (e.g. Rahul ↔ Priya), so it's never fewer payments.
    expect(pw.length).toBeGreaterThanOrEqual(3);
  });

  it('debts that cancel out between two people produce no payment', () => {
    const g = [exp('A', { B: 100 }), exp('B', { A: 100 })];
    expect(service.pairwise(g)).toEqual([]);
    expect(service.simplify(balancesOf(g, ['A', 'B']))).toEqual([]);
  });

  it("the payer's own share is never a debt, and paying only for others works", () => {
    expect(service.pairwise([exp('A', { A: 70, B: 30 })])).toEqual([
      { from: 'B', to: 'A', amountMinor: 30_00 },
    ]);
    expect(service.pairwise([exp('A', { B: 50, C: 50 })])).toEqual([
      { from: 'B', to: 'A', amountMinor: 50_00 },
      { from: 'C', to: 'A', amountMinor: 50_00 },
    ]);
  });

  it('₹100 split three ways (33.34 / 33.33 / 33.33) settles to the exact paisa', () => {
    const g = [exp('A', { A: 33.34, B: 33.33, C: 33.33 })];
    const b = balancesOf(g, ['A', 'B', 'C']);
    expect(b.reduce((s, x) => s + x.netMinor, 0)).toBe(0);
    expect(service.pairwise(g)).toEqual([
      { from: 'B', to: 'A', amountMinor: 33_33 },
      { from: 'C', to: 'A', amountMinor: 33_33 },
    ]);
    expect(afterPaying(b, service.simplify(b)).every((x) => x === 0)).toBe(true);
  });

  it('a cycle (A→B→C→A, equal amounts) needs no payments at all', () => {
    const g = [exp('B', { A: 100 }), exp('C', { B: 100 }), exp('A', { C: 100 })];
    const b = balancesOf(g, ['A', 'B', 'C']);
    expect(b.every((x) => x.netMinor === 0)).toBe(true);
    expect(service.simplify(b)).toEqual([]);
    // Pairwise view still shows the three separate debts (that's what "simplify" removes).
    expect(service.pairwise(g)).toHaveLength(3);
    expect(afterPaying(b, service.pairwise(g)).every((x) => x === 0)).toBe(true);
  });

  describe('fuzz: 500 random groups', () => {
    // Deterministic RNG so a failure is reproducible.
    let seed = 42;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

    for (let run = 0; run < 500; run++) {
      const n = int(2, 7);
      const members = Array.from({ length: n }, (_, i) => `M${i}`);
      const expenses: PairwiseExpense[] = [];
      for (let k = 0, count = int(1, 12); k < count; k++) {
        const paidBy = members[int(0, n - 1)];
        const people = members.filter(() => rnd() < 0.7);
        if (people.length === 0) people.push(members[int(0, n - 1)]);
        // Random paise amounts per person, like exact/percentage/shares splits produce.
        expenses.push({
          paidBy,
          splits: people.map((m) => ({ memberName: m, amountMinor: int(1, 500_000) })),
        });
        if (rnd() < 0.2) {
          // occasional settle-up between two different people
          const a = members[int(0, n - 1)];
          const b = members.find((m) => m !== a)!;
          expenses.push({ paidBy: a, splits: [{ memberName: b, amountMinor: int(1, 200_000) }] });
        }
      }
      const balances = balancesOf(expenses, members);
      const on = service.simplify(balances);
      const off = service.pairwise(expenses);

      it(`group #${run}: both modes settle everyone to exactly 0, with valid payments`, () => {
        expect(balances.reduce((s, b) => s + b.netMinor, 0)).toBe(0);
        for (const list of [on, off]) {
          expect(afterPaying(balances, list).every((x) => x === 0)).toBe(true);
          expect(
            list.every(
              (s) => s.amountMinor > 0 && Number.isInteger(s.amountMinor) && s.from !== s.to,
            ),
          ).toBe(true);
        }
        // Simplified never needs more than n−1 payments.
        expect(on.length).toBeLessThanOrEqual(n - 1);
        // Pairwise has at most one payment per pair of people.
        expect(off.length).toBeLessThanOrEqual((n * (n - 1)) / 2);
        // Nobody pays more in total than they owe (simplified mode moves the least money).
        const moved = (l: SimplifiedSettlement[]) => l.reduce((s, x) => s + x.amountMinor, 0);
        const owed = balances.filter((b) => b.netMinor < 0).reduce((s, b) => s - b.netMinor, 0);
        expect(moved(on)).toBe(owed);
        expect(moved(off)).toBeGreaterThanOrEqual(owed);
      });
    }
  });
});
