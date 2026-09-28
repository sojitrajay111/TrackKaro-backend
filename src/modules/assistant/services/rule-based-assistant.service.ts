import { Injectable, Logger } from '@nestjs/common';

import { CATEGORY_NAMES, CategoryName } from '@/common/constants/categories';
import { formatINR } from '@/common/money/money.util';
import { BudgetsService } from '@/modules/budgets/budgets.service';
import { DealsService } from '@/modules/deals/deals.service';
import { RemindersService } from '@/modules/reminders/reminders.service';
import { SavingsService } from '@/modules/savings/savings.service';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { TransactionsService } from '@/modules/transactions/transactions.service';
import { AffordabilityPayload, ChatReply, FinancialSnapshot, SmartParseResult } from '../types';

const TOP_CATEGORY_COUNT = 4;
const ALL_TRANSACTIONS_LIMIT = 1000;

@Injectable()
export class RuleBasedAssistantService {
  private readonly logger = new Logger(RuleBasedAssistantService.name);

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly dealsService: DealsService,
    private readonly remindersService: RemindersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly savingsService: SavingsService,
    private readonly budgetsService: BudgetsService,
  ) {}

  /**
   * Calculates a live financial snapshot for the user:
   * current balance, upcoming bills, budget remaining, and safe discretionary spending limit.
   */
  async getFinancialSnapshot(userId: string): Promise<FinancialSnapshot> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const { items: allTx } = await this.transactionsService.findAll(userId, {
      page: 1,
      limit: ALL_TRANSACTIONS_LIMIT,
    });

    const incomeTx = allTx.filter((t) => t.type === 'income');
    const totalIncomeAllTime = incomeTx.reduce((sum, t) => sum + t.amount, 0);

    const expenseTx = allTx.filter((t) => t.type === 'expense');
    const totalExpenseAllTime = expenseTx.reduce((sum, t) => sum + t.amount, 0);

    // Current month expenses
    const thisMonthExpenses = expenseTx.filter((t) => {
      const d = new Date(t.date);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });
    const totalSpentThisMonth = thisMonthExpenses.reduce((sum, t) => sum + t.amount, 0);

    // Current month income
    const thisMonthIncome = incomeTx.filter((t) => {
      const d = new Date(t.date);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });
    const totalIncomeThisMonth = thisMonthIncome.reduce((sum, t) => sum + t.amount, 0);

    // Budgets
    const budgets = await this.budgetsService.findAll(userId);
    const totalBudget = budgets.reduce((sum, b) => sum + b.limit, 0);
    const effectiveBudget = totalBudget > 0 ? totalBudget : totalIncomeThisMonth;
    const budgetRemaining = Math.max(0, effectiveBudget - totalSpentThisMonth);

    // Upcoming pending bills
    const reminders = await this.remindersService.findAll(userId);
    const pendingReminders = reminders.filter((r) => r.status === 'pending');
    const upcomingBills = pendingReminders.reduce((sum, r) => sum + r.amount, 0);

    // Actual current balance from recorded income & expenses
    const netBalance = totalIncomeAllTime - totalExpenseAllTime;
    const currentBalance = Math.max(0, netBalance);

    // Safe discretionary spending limit
    const availableAfterBills = Math.max(0, currentBalance - upcomingBills);
    const safeSpendingLimit =
      effectiveBudget > 0 ? Math.min(budgetRemaining, availableAfterBills) : availableAfterBills;

    return {
      currentBalance,
      upcomingBills,
      totalBudget: effectiveBudget,
      budgetRemaining,
      safeSpendingLimit,
      totalSpentThisMonth,
      totalIncomeThisMonth,
      pendingReminders,
      budgets,
    };
  }

  /**
   * Detects and parses affordability questions (e.g. "Can I afford a ₹20,000 phone this month?").
   */
  extractAffordabilityQuery(text: string): { amount: number; item: string } | null {
    const lower = text.toLowerCase();
    const isAffordability =
      lower.includes('afford') ||
      lower.includes('can i buy') ||
      lower.includes('should i buy') ||
      lower.includes('can i spend') ||
      lower.includes('kharid') ||
      lower.includes('le lu') ||
      lower.includes('le sakta');

    if (!isAffordability) return null;

    let amount = 0;
    const kMatch = lower.match(/(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*k\b/i);
    if (kMatch) {
      amount = Math.round(parseFloat(kMatch[1]) * 1000);
    } else {
      const numMatch = lower.match(/(?:₹|rs\.?|inr)?\s*([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{3,7})/);
      if (numMatch) {
        amount = parseInt(numMatch[1].replace(/,/g, ''), 10);
      }
    }

    if (!amount || amount <= 0) return null;

    const commonItems = [
      'phone',
      'mobile',
      'iphone',
      'samsung',
      'laptop',
      'macbook',
      'shoes',
      'shoe',
      'sneakers',
      'watch',
      'smartwatch',
      'headphones',
      'earbuds',
      'tv',
      'bike',
      'car',
      'tablet',
      'ipad',
      'camera',
      'trip',
      'flight',
      'dinner',
      'clothes',
      'jacket',
    ];
    let item = 'phone';
    for (const ci of commonItems) {
      if (lower.includes(ci)) {
        item = ci;
        break;
      }
    }

    return { amount, item };
  }

  /**
   * Formulates a structured Action AI affordability check response.
   */
  async replyAffordability(
    userId: string,
    requestedAmount: number,
    item: string,
  ): Promise<Pick<ChatReply, 'text' | 'actionType' | 'payload'>> {
    const snapshot = await this.getFinancialSnapshot(userId);
    const { currentBalance, upcomingBills, budgetRemaining, safeSpendingLimit } = snapshot;

    let verdict: 'safe' | 'caution' | 'danger' = 'safe';
    let verdictTitle = 'Yes! You can comfortably afford this.';
    let verdictSubtitle = `This purchase fits within your safe discretionary budget of ${formatINR(safeSpendingLimit)}.`;
    let warning: string | undefined = undefined;

    if (currentBalance === 0 && requestedAmount > 0) {
      verdict = 'caution';
      verdictTitle = 'No income or balance recorded yet.';
      verdictSubtitle =
        "Please log your income or bank balance using the '+' button to run an accurate affordability check.";
      warning = '⚠️ Your recorded balance is ₹0.';
    } else if (requestedAmount > currentBalance) {
      verdict = 'danger';
      verdictTitle = "No, I'd strongly advise against this.";
      verdictSubtitle = `This purchase exceeds your current available balance of ${formatINR(currentBalance)}.`;
      warning = `⚠️ ${formatINR(requestedAmount)} exceeds your total available balance.`;
    } else if (requestedAmount > safeSpendingLimit) {
      verdict = 'caution';
      verdictTitle = "Yes, but I'd recommend waiting.";
      verdictSubtitle = `Your safe discretionary spending limit this month is ${formatINR(safeSpendingLimit)}.`;
      warning = `⚠️ ${formatINR(requestedAmount)} would exceed your safe discretionary budget.`;
    }

    const safeCeilK = safeSpendingLimit > 0 ? Math.round(safeSpendingLimit / 1000) * 1000 : 0;
    const limitLabel =
      safeCeilK >= 1000 ? `${Math.round(safeCeilK / 1000)}K` : formatINR(safeCeilK);

    let actionButton: AffordabilityPayload['actionButton'] = undefined;
    if (currentBalance > 0 && safeSpendingLimit > 0) {
      actionButton =
        verdict === 'caution' || verdict === 'danger'
          ? {
              label: `Find ${item}s under ₹${limitLabel}`,
              action: 'search_deals',
              params: {
                query: item,
                maxPrice: safeSpendingLimit,
              },
            }
          : {
              label: `Find deals for ${item}`,
              action: 'search_deals',
              params: {
                query: item,
                maxPrice: requestedAmount,
              },
            };
    }

    const payload: AffordabilityPayload = {
      item,
      requestedAmount,
      verdict,
      verdictTitle,
      verdictSubtitle,
      metrics: {
        currentBalance,
        upcomingBills,
        budgetRemaining,
        safeSpendingLimit,
      },
      warning,
      actionButton,
    };

    const text =
      `${verdictTitle}\n\n` +
      `Current balance      ${formatINR(currentBalance)}\n` +
      `Upcoming bills       ${formatINR(upcomingBills)}\n` +
      `Budget remaining     ${formatINR(budgetRemaining)}\n` +
      `Safe spending limit  ${formatINR(safeSpendingLimit)}\n\n` +
      (warning ? `${warning}\n\n` : '') +
      (actionButton ? `[${actionButton.label}]` : '').trim();

    return {
      text,
      actionType: 'affordability_check',
      payload,
    };
  }

  /**
   * Explains TrackKaro scope and guides users to Google for market price searches.
   */
  async replyPriceLookupGuide(userId: string): Promise<string> {
    const snapshot = await this.getFinancialSnapshot(userId);
    const safeLimitText =
      snapshot.safeSpendingLimit > 0
        ? `Your safe limit: ${formatINR(snapshot.safeSpendingLimit)}`
        : 'Tap + to log income & calculate limit';

    return (
      `🔍 **TrackKaro is your Personal Finance & Budget Assistant**, not a real-time shopping search engine.\n\n` +
      `For live market prices, retailer comparisons, or product searches, please do a quick **Google search** or check **Amazon**, **Flipkart**, or **Croma** directly!\n\n` +
      `💡 **Here is what you can ask me about your finances:**\n` +
      `• **"How much money can I safely spend?"** (${safeLimitText})\n` +
      `• **"Can I afford a ₹20,000 phone?"** (Instant affordability check against your balance)\n` +
      `• **"What are my upcoming bills?"** (${snapshot.pendingReminders.length} pending bill reminders)\n` +
      `• **"How much did I spend on Food this month?"**\n` +
      `• **"Audit my active subscriptions"**\n\n` +
      `🛍️ You can also explore our **Deals tab** for curated discounts and promo codes!`
    );
  }

  /**
   * Generates a safe discretionary spending answer based purely on authentic user data.
   */
  async replySafeSpend(userId: string): Promise<string> {
    const snapshot = await this.getFinancialSnapshot(userId);
    const {
      currentBalance,
      upcomingBills,
      totalBudget,
      budgetRemaining,
      safeSpendingLimit,
      totalSpentThisMonth,
      pendingReminders,
    } = snapshot;

    if (currentBalance === 0 && totalSpentThisMonth === 0) {
      return (
        `💰 **Safe Spending Limit: ₹0**\n\n` +
        `No income or account balance has been recorded yet.\n\n` +
        `💡 **To calculate your safe spending limit:**\n` +
        `1. Tap the **+** button at the bottom of the screen.\n` +
        `2. Log your monthly income or bank balance.\n\n` +
        `Once added, TrackKaro will automatically subtract your upcoming bills (${pendingReminders.length > 0 ? formatINR(upcomingBills) + ' pending' : 'no pending bills'}) and budgets to calculate your safe limit!`
      );
    }

    let statusNote = '✅ This fits comfortably within your monthly budget and bill commitments.';
    if (safeSpendingLimit <= 0) {
      statusNote =
        '⚠️ You have reached your safe spending limit. Prioritize pending bills and essential expenses.';
    }

    return (
      `💰 You can safely spend up to **${formatINR(safeSpendingLimit)}** this month!\n\n` +
      `**Live Financial Snapshot:**\n` +
      `• Current balance: ${formatINR(currentBalance)}\n` +
      `• Upcoming bills: ${formatINR(upcomingBills)} (${pendingReminders.length} pending)\n` +
      `• Monthly budget: ${formatINR(totalBudget)}\n` +
      `• Budget remaining: ${formatINR(budgetRemaining)}\n` +
      `• Spent this month: ${formatINR(totalSpentThisMonth)}\n\n` +
      statusNote
    );
  }

  /**
   * Generates a structured monthly spending breakdown based on authentic transactions.
   */
  async replySpendingSummary(userId: string): Promise<string> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthName = now.toLocaleString('default', { month: 'long' });

    const { items } = await this.transactionsService.findAll(userId, {
      type: 'expense',
      page: 1,
      limit: ALL_TRANSACTIONS_LIMIT,
    });

    const thisMonthExpenses = items.filter((t) => {
      const d = new Date(t.date);
      return d.getFullYear() === currentYear && d.getMonth() === currentMonth;
    });

    if (thisMonthExpenses.length === 0) {
      return (
        `📊 **No expenses recorded for ${monthName} yet!**\n\n` +
        `You haven't logged any expenses so far this month.\n\n` +
        `💡 **Quick ways to start tracking:**\n` +
        `• Tap the **+** button at the bottom to log daily expenses.\n` +
        `• Scan a paper bill or receipt using the receipt scanner.\n` +
        `• Use voice logging to add transactions hands-free.\n\n` +
        `Once you add your expenses, I'll provide category breakdowns, top spending areas, and actionable budget insights here!`
      );
    }

    const totalSpent = thisMonthExpenses.reduce((sum, t) => sum + t.amount, 0);
    const byCategory = new Map<string, number>();
    for (const tx of thisMonthExpenses) {
      byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + tx.amount);
    }

    const topCategories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

    const categoryLines = topCategories
      .map(([cat, amt]) => {
        const pct = totalSpent > 0 ? Math.round((amt / totalSpent) * 100) : 0;
        return `• **${cat}:** ${formatINR(amt)} (${pct}%)`;
      })
      .join('\n');

    return (
      `📊 **Spending Breakdown for ${monthName}:**\n\n` +
      `• **Total Spent:** ${formatINR(totalSpent)} (${thisMonthExpenses.length} transaction${thisMonthExpenses.length === 1 ? '' : 's'})\n\n` +
      `**Top Spending Categories:**\n` +
      categoryLines
    );
  }

  async replyFoodSpend(userId: string): Promise<string> {
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

  async replyTopCategories(userId: string): Promise<string> {
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

  async replyReminder(
    userId: string,
  ): Promise<Pick<ChatReply, 'text' | 'actionType' | 'payload'>> {
    const reminders = await this.remindersService.findAll(userId);
    const pending = reminders
      .filter((r) => r.status === 'pending')
      .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    const next = pending[0];

    if (!next) return { text: 'You have no pending bill reminders right now. 🎉' };

    const dueDate = new Date(next.dueDate).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
    });
    return {
      text: `⏰ You have ${pending.length} pending bill${pending.length > 1 ? 's' : ''}.\nNext: ${next.title} (${formatINR(next.amount)}) is due on ${dueDate}.`,
      actionType: 'reminder_action',
      payload: {
        totalPending: pending.reduce((sum, r) => sum + r.amount, 0),
        pendingCount: pending.length,
        nextBill: next,
      },
    };
  }

  async replySavings(userId: string): Promise<string> {
    const m = await this.savingsService.getFullMetrics(userId);
    return (
      `🎉 Total savings so far: ${formatINR(m.totalSaved)}!\n` +
      `• Deal Discounts: ${formatINR(m.dealSavings)}\n` +
      `• Coupons Applied: ${formatINR(m.couponSavings)}\n` +
      `• Bank Cashback: ${formatINR(m.cashback)}\n` +
      `• Avoided Unnecessary Costs: ${formatINR(m.avoidedExpenses)}`
    );
  }

  async replySubscriptions(
    userId: string,
  ): Promise<Pick<ChatReply, 'text' | 'actionType' | 'payload'>> {
    const subs = await this.subscriptionsService.findAll(userId);
    if (subs.length === 0) return { text: "You don't have any subscriptions tracked yet." };

    const monthlyTotal = subs.reduce(
      (acc, s) => acc + (s.billingCycle === 'Yearly' ? s.amount / 12 : s.amount),
      0,
    );
    const redundant = subs.filter((s) => s.isRedundant);
    const redundantSavings = redundant.reduce(
      (acc, s) => acc + (s.billingCycle === 'Yearly' ? s.amount : s.amount * 12),
      0,
    );

    let text = `📱 You have ${subs.length} active subscription${subs.length === 1 ? '' : 's'} costing ${formatINR(monthlyTotal)}/month.`;
    if (redundant.length > 0) {
      text += `\n⚠️ TrackKaro flagged ${redundant.length} redundant plan${redundant.length === 1 ? '' : 's'}! You could save ${formatINR(redundantSavings)}/year.`;
    }

    return {
      text,
      actionType: 'subscription_action',
      payload: {
        totalSubs: subs.length,
        monthlyTotal,
        redundantCount: redundant.length,
        potentialAnnualSavings: redundantSavings,
        redundantList: redundant,
      },
    };
  }

  async replyReduceCosts(userId: string): Promise<string> {
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

  private extractProductQuery(userText: string): string {
    let q = (userText || '').toLowerCase().trim();
    q = q.replace(/[?!.,;:]/g, ' ');
    q = q
      .replace(
        /\b(what('?s| is)?|how much( is)?|tell me|find( me)?|show( me)?|give me|check|search for|any)\b/gi,
        ' ',
      )
      .replace(/\b(the )?(best|lowest|cheapest|latest|top|good|discounted|special)?\b/gi, ' ')
      .replace(
        /\b(price|prices|pricing|deal|deals|offer|offers|discount|discounts|coupon|coupons|rate|rates|cost|costs)\b/gi,
        ' ',
      )
      .replace(/\b(for|of|on|in|about|at|with)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return q;
  }

  async replyDeal(
    userId: string,
    query?: string,
  ): Promise<Pick<ChatReply, 'text' | 'actionType' | 'payload'> | null> {
    const rawQ = (query || '').toLowerCase().trim();
    const cleanQ = this.extractProductQuery(rawQ);
    const keywords = cleanQ.split(/\s+/).filter((w) => w.length > 1);

    let deals = await this.dealsService.findAll(userId);

    // 1. High priority: match specific product title
    let topDeal = deals.find((d) => {
      const t = d.title.toLowerCase();
      if (cleanQ.length > 2 && t.includes(cleanQ)) return true;
      if (keywords.length > 0 && keywords.every((kw) => t.includes(kw))) return true;
      return false;
    });

    // 2. If no exact match and user asked for a specific product, search live via AI
    if (!topDeal && cleanQ.length > 2) {
      try {
        const freshDeals = await this.dealsService.discoverDeals(userId, cleanQ);
        if (freshDeals && freshDeals.length > 0) {
          deals = freshDeals;
          topDeal = deals.find((d) => {
            const t = d.title.toLowerCase();
            if (t.includes(cleanQ)) return true;
            if (keywords.length > 0 && keywords.every((kw) => t.includes(kw))) return true;
            return false;
          });
        }
      } catch {
        // fallback to local search
      }
    }

    // 3. Category / keyword fallback ONLY if user did not ask for a specific named item
    if (!topDeal && cleanQ.length === 0) {
      topDeal = deals.find((d) => {
        const t = d.title.toLowerCase();
        const c = (d.category || '').toLowerCase();
        return (
          (rawQ.includes('phone') &&
            (t.includes('phone') ||
              t.includes('galaxy') ||
              t.includes('samsung') ||
              t.includes('iphone') ||
              c.includes('electronics'))) ||
          (rawQ.includes('laptop') &&
            (t.includes('laptop') ||
              t.includes('hp') ||
              t.includes('macbook') ||
              c.includes('electronics'))) ||
          (rawQ.includes('shoe') &&
            (t.includes('shoe') || t.includes('nike') || t.includes('sneaker'))) ||
          (rawQ.includes('swiggy') && (t.includes('swiggy') || c.includes('food'))) ||
          t.includes(rawQ)
        );
      });
    }

    if (!topDeal) {
      return null;
    }

    const text =
      `🛍️ I found a great deal on ${topDeal.platform}!\n` +
      `• ${topDeal.title}\n` +
      `• Final Price: ${formatINR(topDeal.finalPrice)} (Save ${formatINR(topDeal.savingsAmount)})\n` +
      (topDeal.couponCode
        ? `• Coupon (${topDeal.couponCode}): Extra ${topDeal.discountPercent}% Off`
        : '');

    return { text, actionType: 'deal_recommendation', payload: topDeal };
  }

  fallbackLocalParse(text: string, mode: 'expense' | 'khata'): SmartParseResult {
    const today = new Date().toISOString().split('T')[0];
    const amtMatch = text.match(/\b(\d+(?:[.,]\d+)?)\b/);
    const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : 0;
    const lower = text.toLowerCase();

    if (mode === 'expense') {
      let category: CategoryName = 'Other';
      if (/grocer|kirana|sabzi|vegetable|doodh|milk|ration/i.test(lower)) category = 'Groceries';
      else if (/petrol|diesel|fuel/i.test(lower)) category = 'Fuel';
      else if (/chai|tea|coffee|food|lunch|dinner|swiggy|zomato/i.test(lower)) category = 'Food';
      else if (/medicine|doctor|health/i.test(lower)) category = 'Health';

      const type = /salary|income|credit|received/i.test(lower) ? 'income' : 'expense';
      return {
        transcript: text,
        amount,
        title: /zepto/i.test(lower) ? 'Zepto' : /swiggy/i.test(lower) ? 'Swiggy' : 'Expense',
        category,
        type,
        date: today,
      };
    } else {
      const type = /took|lidha|received|borrow/i.test(lower) ? 'took' : 'gave';
      return {
        transcript: text,
        amount,
        title: 'Contact',
        personName: 'Contact',
        category: 'Other',
        type,
        date: today,
      };
    }
  }

  /**
   * Fallback rule-based reply generator when external AI is not set or fails.
   */
  async generateRuleBasedReply(userId: string, userText: string): Promise<ChatReply> {
    const lower = userText.toLowerCase();
    let text = "I've analyzed your financial data! Let me know what you'd like to check.";
    let actionType: ChatReply['actionType'];
    let payload: unknown;

    if (
      lower.includes('price') ||
      lower.includes('cost') ||
      lower.includes('rate') ||
      lower.includes('how much') ||
      lower.includes('best price') ||
      lower.includes('samsung') ||
      lower.includes('s24') ||
      lower.includes('iphone') ||
      lower.includes('deal') ||
      lower.includes('discount') ||
      lower.includes('coupon') ||
      lower.includes('offer')
    ) {
      text = await this.replyPriceLookupGuide(userId);
    } else if (
      lower.includes('safely spend') ||
      lower.includes('safe to spend') ||
      lower.includes('safe spend') ||
      lower.includes('spending limit')
    ) {
      text = await this.replySafeSpend(userId);
    } else if (
      lower.includes('analyze') ||
      lower.includes('spending') ||
      lower.includes('breakdown') ||
      lower.includes('expense report')
    ) {
      text = await this.replySpendingSummary(userId);
    } else if (lower.includes('food')) {
      text = await this.replyFoodSpend(userId);
    } else if (lower.includes('where') && (lower.includes('spending') || lower.includes('most'))) {
      text = await this.replyTopCategories(userId);
    } else if (
      lower.includes('remind') ||
      lower.includes('credit card') ||
      lower.includes('bill') ||
      lower.includes('due')
    ) {
      const result = await this.replyReminder(userId);
      text = result.text;
      actionType = result.actionType;
      payload = result.payload;
    } else if (lower.includes('save') || lower.includes('savings')) {
      text = await this.replySavings(userId);
      actionType = 'savings_summary';
    } else if (lower.includes('subscription')) {
      const result = await this.replySubscriptions(userId);
      text = result.text;
      actionType = result.actionType;
      payload = result.payload;
    } else if (lower.includes('reduce') || lower.includes('cut') || lower.includes('waste')) {
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
}
