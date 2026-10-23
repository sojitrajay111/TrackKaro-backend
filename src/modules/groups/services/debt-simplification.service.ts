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

/** The parts of a group expense the pairwise view needs (settlements included). */
export interface PairwiseExpense {
  paidBy: string;
  splits: { memberName: string; amountMinor: number }[];
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

  /**
   * "Simplify debts" OFF (Splitwise's default view): every share someone else paid for is a debt
   * from that member to the payer; the two directions between each pair are then netted.
   * Settle-ups are stored as an expense paid by the debtor with the creditor as the only split,
   * so they reduce the pair's debt naturally. Payer's own share is never a debt.
   * Result is sorted (from, then to) so the list is stable between loads.
   */
  pairwise(expenses: PairwiseExpense[]): SimplifiedSettlement[] {
    // owes.get(debtor).get(creditor) = paise the debtor owes the creditor (before netting)
    const owes = new Map<string, Map<string, number>>();
    const add = (debtor: string, creditor: string, amount: number) => {
      const row = owes.get(debtor) ?? new Map<string, number>();
      row.set(creditor, (row.get(creditor) ?? 0) + amount);
      owes.set(debtor, row);
    };
    for (const e of expenses) {
      for (const s of e.splits) {
        if (s.memberName === e.paidBy || s.amountMinor === 0) continue;
        add(s.memberName, e.paidBy, s.amountMinor);
      }
    }
    const get = (a: string, b: string) => owes.get(a)?.get(b) ?? 0;

    const names = new Set<string>();
    owes.forEach((row, debtor) => {
      names.add(debtor);
      row.forEach((_, creditor) => names.add(creditor));
    });
    const list = [...names].sort();

    const settlements: SimplifiedSettlement[] = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const net = get(a, b) - get(b, a);
        if (net > 0) settlements.push({ from: a, to: b, amountMinor: net });
        else if (net < 0) settlements.push({ from: b, to: a, amountMinor: -net });
      }
    }
    return settlements.sort((x, y) => x.from.localeCompare(y.from) || x.to.localeCompare(y.to));
  }
}
