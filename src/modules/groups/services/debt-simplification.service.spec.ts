import { DebtSimplificationService } from './debt-simplification.service';

describe('DebtSimplificationService', () => {
  const service = new DebtSimplificationService();

  it('returns nothing when everyone is already settled', () => {
    expect(
      service.simplify([
        { name: 'A', netMinor: 0 },
        { name: 'B', netMinor: 0 },
      ]),
    ).toEqual([]);
  });

  it('settles a simple two-person debt directly', () => {
    const result = service.simplify([
      { name: 'A', netMinor: -50_00 },
      { name: 'B', netMinor: 50_00 },
    ]);
    expect(result).toEqual([{ from: 'A', to: 'B', amountMinor: 50_00 }]);
  });

  it('minimizes transactions for a three-person cycle-like case', () => {
    // A owes 100, B is owed 60, C is owed 40 — should resolve in exactly 2 payments, not 3.
    const result = service.simplify([
      { name: 'A', netMinor: -100_00 },
      { name: 'B', netMinor: 60_00 },
      { name: 'C', netMinor: 40_00 },
    ]);
    expect(result).toHaveLength(2);
    const total = result.reduce((acc, s) => acc + s.amountMinor, 0);
    expect(total).toBe(100_00);
  });

  it('handles a rounding-remainder three-way equal split (₹100 / 3) exactly', () => {
    // ₹100 split 3 ways with the remainder assigned to the payer, as the client does:
    // payer share 33.34, other two 33.33 each — net balances must still sum to zero.
    const balances = [
      { name: 'Payer', netMinor: 100_00 - 33_34 }, // paid 100.00, owes back their own 33.34 share
      { name: 'B', netMinor: -33_33 },
      { name: 'C', netMinor: -33_33 },
    ];
    expect(balances.reduce((acc, b) => acc + b.netMinor, 0)).toBe(0);

    const result = service.simplify(balances);
    const totalSettled = result.reduce((acc, s) => acc + s.amountMinor, 0);
    expect(totalSettled).toBe(33_33 + 33_33);
    expect(result.every((s) => s.to === 'Payer')).toBe(true);
  });

  it('produces no settlement smaller than 0 and never pays a person more than they are owed', () => {
    const result = service.simplify([
      { name: 'A', netMinor: -30_00 },
      { name: 'B', netMinor: -20_00 },
      { name: 'C', netMinor: 50_00 },
    ]);
    const paidToC = result.filter((s) => s.to === 'C').reduce((acc, s) => acc + s.amountMinor, 0);
    expect(paidToC).toBe(50_00);
    expect(result.every((s) => s.amountMinor > 0)).toBe(true);
  });
});
