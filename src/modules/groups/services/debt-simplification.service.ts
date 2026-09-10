import { Injectable } from '@nestjs/common';

export interface MemberBalance {
  name: string;
  netMinor: number;
}

export interface SimplifiedSettlement {
  from: string;
  to: string;
  amountMinor: number;
}

/**
 * Greedy pairwise debt simplification: repeatedly matches the largest creditor against the
 * largest debtor. Ported from the client-side algorithm that shipped in
 * TrackKaro/src/components/groups/GroupDetailModal.tsx — same behavior, integer paise instead
 * of float rupees (so no epsilon/rounding tolerance is needed here).
 */
@Injectable()
export class DebtSimplificationService {
  simplify(balances: MemberBalance[]): SimplifiedSettlement[] {
    const debtors = balances
      .filter((b) => b.netMinor < 0)
      .map((b) => ({ name: b.name, amount: -b.netMinor }))
      .sort((a, b) => b.amount - a.amount);

    const creditors = balances
      .filter((b) => b.netMinor > 0)
      .map((b) => ({ name: b.name, amount: b.netMinor }))
      .sort((a, b) => b.amount - a.amount);

    const settlements: SimplifiedSettlement[] = [];
    let d = 0;
    let c = 0;

    while (d < debtors.length && c < creditors.length) {
      const debtor = debtors[d];
      const creditor = creditors[c];

      const settledAmount = Math.min(debtor.amount, creditor.amount);
      if (settledAmount > 0) {
        settlements.push({ from: debtor.name, to: creditor.name, amountMinor: settledAmount });
      }

      debtor.amount -= settledAmount;
      creditor.amount -= settledAmount;

      if (debtor.amount === 0) d++;
      if (creditor.amount === 0) c++;
    }

    return settlements;
  }
}
