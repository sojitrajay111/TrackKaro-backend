import { Injectable } from '@nestjs/common';

import { formatINR } from '@/common/money/money.util';
import { DealsService } from '@/modules/deals/deals.service';
import { RemindersService } from '@/modules/reminders/reminders.service';
import { SavingsService } from '@/modules/savings/savings.service';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { TransactionsService } from '@/modules/transactions/transactions.service';

export interface ChatReply {
  id: string;
  sender: 'ai';
  text: string;
  timestamp: string;
  actionType?: 'deal_recommendation' | 'reminder_set' | 'expense_added' | 'savings_summary';
  payload?: unknown;
}

const TOP_CATEGORY_COUNT = 4;
const ALL_TRANSACTIONS_LIMIT = 1000;

/**
 * Rule-based reply generator — same branching the client used to do locally, now run against
 * real backend data instead of hardcoded numbers. No LLM call; the contract (POST
 * /assistant/messages -> ChatReply) is deliberately stable so a real model can replace this
 * implementation later without any frontend change.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly dealsService: DealsService,
    private readonly remindersService: RemindersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly savingsService: SavingsService,
  ) {}

  async generateReply(userId: string, userText: string): Promise<ChatReply> {
    const lower = userText.toLowerCase();
    let text = "I've analyzed your data! Let me know if you'd like more specific advice.";
    let actionType: ChatReply['actionType'];
    let payload: unknown;

    if (lower.includes('food')) {
      text = await this.replyFoodSpend(userId);
    } else if (lower.includes('where') && (lower.includes('spending') || lower.includes('most'))) {
      text = await this.replyTopCategories(userId);
    } else if (lower.includes('nike') || lower.includes('shoe') || lower.includes('deal')) {
      const result = await this.replyDeal(userId);
      text = result.text;
      actionType = result.actionType;
      payload = result.payload;
    } else if (
      lower.includes('remind') ||
      lower.includes('credit card') ||
      lower.includes('bill')
    ) {
      const result = await this.replyReminder(userId);
      text = result.text;
      actionType = result.actionType;
    } else if (lower.includes('save') || lower.includes('savings')) {
      text = await this.replySavings(userId);
      actionType = 'savings_summary';
    } else if (lower.includes('subscription')) {
      text = await this.replySubscriptions(userId);
    } else if (lower.includes('reduce') || lower.includes('cut')) {
      text = await this.replyReduceCosts(userId);
    }

    return {
      id: 'chat-' + Date.now(),
      sender: 'ai',
      text,
      timestamp: new Date().toISOString(),
      actionType,
      payload,
    };
  }

  private async replyFoodSpend(userId: string): Promise<string> {
    const { items, total } = await this.transactionsService.findAll(userId, {
      category: 'Food',
      type: 'expense',
      page: 1,
      limit: ALL_TRANSACTIONS_LIMIT,
    });
    if (total === 0) return "You haven't recorded any Food expenses yet.";
    const foodSpent = items.reduce((acc, tx) => acc + tx.amount, 0);
    return `📊 You have spent ${formatINR(foodSpent)} on Food across ${total} transaction${total === 1 ? '' : 's'}.`;
  }

  private async replyTopCategories(userId: string): Promise<string> {
    const { items } = await this.transactionsService.findAll(userId, {
      type: 'expense',
      page: 1,
      limit: ALL_TRANSACTIONS_LIMIT,
    });
    if (items.length === 0) return "You haven't recorded any expenses yet.";

    const byCategory = new Map<string, number>();
    for (const tx of items) {
      byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + tx.amount);
    }
    const top = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_CATEGORY_COUNT);

    const lines = top.map(
      ([category, amount], i) => `${i + 1}. ${category} (${formatINR(amount)})`,
    );
    return `💡 Your highest spending categories are:\n${lines.join('\n')}`;
  }

  private async replyDeal(
    userId: string,
  ): Promise<Pick<ChatReply, 'text' | 'actionType' | 'payload'>> {
    const deals = await this.dealsService.findAll(userId);
    const topDeal = deals.find((d) => d.title.toLowerCase().includes('nike')) ?? deals[0];
    if (!topDeal) return { text: "I couldn't find any deals to recommend right now." };

    const text =
      `🛍️ I found a great deal on ${topDeal.platform}!\n` +
      `• Current Price: ${formatINR(topDeal.currentPrice)}\n` +
      (topDeal.couponCode
        ? `• Coupon (${topDeal.couponCode}): Extra ${topDeal.discountPercent}% Off\n`
        : '') +
      `• Net Effective Price: ${formatINR(topDeal.finalPrice)} (Save ${formatINR(topDeal.savingsAmount)})!`;

    return { text, actionType: 'deal_recommendation', payload: topDeal };
  }

  private async replyReminder(userId: string): Promise<Pick<ChatReply, 'text' | 'actionType'>> {
    const reminders = await this.remindersService.findAll(userId);
    const next = reminders
      .filter((r) => r.status === 'pending')
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())[0];

    if (!next) return { text: 'You have no pending bill reminders right now. 🎉' };

    const dueDate = new Date(next.dueDate).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    });
    return {
      text: `⏰ Your ${next.title} of ${formatINR(next.amount)} is due on ${dueDate}.`,
      actionType: 'reminder_set',
    };
  }

  private async replySavings(userId: string): Promise<string> {
    const m = await this.savingsService.getFullMetrics(userId);
    return (
      `🎉 Total savings so far: ${formatINR(m.totalSaved)}!\n` +
      `• Deal Discounts: ${formatINR(m.dealSavings)}\n` +
      `• Coupons Applied: ${formatINR(m.couponSavings)}\n` +
      `• Bank Cashback: ${formatINR(m.cashback)}\n` +
      `• Avoided Unnecessary Costs: ${formatINR(m.avoidedExpenses)}`
    );
  }

  private async replySubscriptions(userId: string): Promise<string> {
    const subs = await this.subscriptionsService.findAll(userId);
    if (subs.length === 0) return "You don't have any subscriptions tracked yet.";

    const monthlyTotal = subs.reduce(
      (acc, s) => acc + (s.billingCycle === 'Yearly' ? s.amount / 12 : s.amount),
      0,
    );
    const redundant = subs.filter((s) => s.isRedundant);

    let text = `📱 You have ${subs.length} active subscription${subs.length === 1 ? '' : 's'} costing ${formatINR(monthlyTotal)}/month.`;
    if (redundant.length > 0) {
      text += ` TrackKaro flagged ${redundant.length} redundant subscription${redundant.length === 1 ? '' : 's'} (${redundant.map((s) => s.name).join(', ')}) you could cancel.`;
    }
    return text;
  }

  private async replyReduceCosts(userId: string): Promise<string> {
    const subs = await this.subscriptionsService.findAll(userId);
    const redundant = subs.filter((s) => s.isRedundant);
    if (redundant.length === 0) {
      return "No redundant subscriptions detected right now — you're already lean! 🎉";
    }

    const monthlySavings = redundant.reduce(
      (acc, s) => acc + (s.billingCycle === 'Yearly' ? s.amount / 12 : s.amount),
      0,
    );
    const lines = redundant.map(
      (s) =>
        `• Cancel ${s.name} (save ${formatINR(s.billingCycle === 'Yearly' ? s.amount / 12 : s.amount)}/mo)`,
    );
    return `💡 TrackKaro Recommendation Plan:\n${lines.join('\n')}\nTotal potential monthly saving: ${formatINR(monthlySavings)}`;
  }
}
