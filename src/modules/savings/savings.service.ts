import { Injectable } from '@nestjs/common';

import { toMajorUnits } from '@/common/money/money.util';
import { DealsService } from '@/modules/deals/deals.service';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';

export interface MonthlySavingsPoint {
  month: string;
  amount: number;
}

export interface FullSavingsMetrics {
  totalSaved: number;
  currentMonthSaved: number;
  previousMonthSaved: number;
  dealSavings: number;
  couponSavings: number;
  cashback: number;
  avoidedExpenses: number;
  potentialSavings: number;
  monthlyHistory: MonthlySavingsPoint[];
}

const MONTHS_PER_YEAR = 12;
const DEFAULT_CASHBACK = 100;
const HISTORY_MONTHS = 5;

type TrackedDeal = {
  savingsAmountMinor: number;
  couponCode?: string;
  cashbackText?: string;
  currentPriceMinor: number;
  discountPercent: number;
  createdAt: Date;
};

@Injectable()
export class SavingsService {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly dealsService: DealsService,
  ) {}

  /** Genuine savings, computed from real tracked deals and real redundant subscriptions —
   * nothing here is a synthetic ratio. Per-month figures are derived by filtering tracked
   * deals to each deal's own `createdAt`; the redundant-subscription monthly-equivalent is
   * applied as a flat baseline across months since we don't keep a history of when a
   * subscription was first flagged redundant. */
  async getFullMetrics(userId: string): Promise<FullSavingsMetrics> {
    const [deals, avoidedExpenses] = await Promise.all([
      this.dealsService.findTrackedForSavings(userId),
      this.subscriptionsService.sumRedundantMonthlyEquivalent(userId),
    ]);

    const dealSavings = this.sumDealSavings(deals);
    const couponSavings = this.sumCouponSavings(deals);
    const cashback = this.sumCashback(deals);
    const totalSaved = dealSavings + couponSavings + cashback + avoidedExpenses;

    const now = new Date();
    const currentMonthSaved =
      this.sumDealsInMonth(deals, now.getFullYear(), now.getMonth()) + avoidedExpenses;
    const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonthSaved =
      this.sumDealsInMonth(deals, previousMonth.getFullYear(), previousMonth.getMonth()) +
      avoidedExpenses;

    const monthlyHistory: MonthlySavingsPoint[] = [];
    for (let i = HISTORY_MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthlyHistory.push({
        month: d.toLocaleDateString('en-US', { month: 'short' }),
        amount: this.sumDealsInMonth(deals, d.getFullYear(), d.getMonth()) + avoidedExpenses,
      });
    }

    return {
      totalSaved,
      currentMonthSaved,
      previousMonthSaved,
      dealSavings,
      couponSavings,
      cashback,
      avoidedExpenses,
      potentialSavings: avoidedExpenses * MONTHS_PER_YEAR,
      monthlyHistory,
    };
  }

  private sumDealSavings(deals: TrackedDeal[]): number {
    return toMajorUnits(deals.reduce((acc, d) => acc + (d.savingsAmountMinor || 0), 0));
  }

  private sumCouponSavings(deals: TrackedDeal[]): number {
    return deals
      .filter((d) => d.couponCode)
      .reduce((acc, d) => acc + Math.round((toMajorUnits(d.currentPriceMinor) * d.discountPercent) / 100), 0);
  }

  private sumCashback(deals: TrackedDeal[]): number {
    return deals
      .filter((d) => d.cashbackText)
      .reduce((acc, d) => {
        const match = d.cashbackText?.match(/\d+/);
        return acc + (match ? parseInt(match[0], 10) : DEFAULT_CASHBACK);
      }, 0);
  }

  private sumDealsInMonth(deals: TrackedDeal[], year: number, month: number): number {
    const inMonth = deals.filter((d) => d.createdAt.getFullYear() === year && d.createdAt.getMonth() === month);
    return this.sumDealSavings(inMonth) + this.sumCouponSavings(inMonth) + this.sumCashback(inMonth);
  }
}
