import { Injectable } from '@nestjs/common';

import { DealsService } from '@/modules/deals/deals.service';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';

export interface FullSavingsMetrics {
  totalSaved: number;
  currentMonthSaved: number;
  previousMonthSaved: number;
  dealSavings: number;
  couponSavings: number;
  cashback: number;
  avoidedExpenses: number;
  potentialSavings: number;
}

const MONTHS_PER_YEAR = 12;
const PREVIOUS_MONTH_RATIO = 0.85;
const DEFAULT_CASHBACK = 100;

@Injectable()
export class SavingsService {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly dealsService: DealsService,
  ) {}

  /** Ports the exact formula from the pre-backend client's savingsMetrics useMemo, now run
   * against real tracked deals and real subscriptions instead of Context state. */
  async getFullMetrics(userId: string): Promise<FullSavingsMetrics> {
    const [deals, avoidedExpenses] = await Promise.all([
      this.dealsService.findAll(userId),
      this.subscriptionsService.sumRedundantMonthlyEquivalent(userId),
    ]);

    const tracked = deals.filter((d) => d.tracked);

    const dealSavings = tracked.reduce((acc, d) => acc + (d.savingsAmount || 0), 0);

    const couponSavings = tracked
      .filter((d) => d.couponCode)
      .reduce((acc, d) => acc + Math.round((d.currentPrice * d.discountPercent) / 100), 0);

    const cashback = tracked
      .filter((d) => d.cashbackText)
      .reduce((acc, d) => {
        const match = d.cashbackText?.match(/\d+/);
        return acc + (match ? parseInt(match[0], 10) : DEFAULT_CASHBACK);
      }, 0);

    const totalSaved = dealSavings + couponSavings + cashback + avoidedExpenses;

    return {
      totalSaved,
      currentMonthSaved: totalSaved,
      previousMonthSaved: Math.round(totalSaved * PREVIOUS_MONTH_RATIO),
      dealSavings,
      couponSavings,
      cashback,
      avoidedExpenses,
      potentialSavings: avoidedExpenses * MONTHS_PER_YEAR,
    };
  }
}
