import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

export interface ScannedBillResult {
  merchant: string;
  amount: number;
  category: string;
  date: string;
}

const TOP_CATEGORY_COUNT = 4;
const ALL_TRANSACTIONS_LIMIT = 1000;

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly transactionsService: TransactionsService,
    private readonly dealsService: DealsService,
    private readonly remindersService: RemindersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly savingsService: SavingsService,
  ) {}

  /**
   * Generates an assistant reply.
   * If GEMINI_API_KEY is configured, it calls Gemini 1.5 Flash with the user's financial
   * summary. Otherwise (or on API error), it gracefully falls back to rule-based analysis.
   */
  async generateReply(userId: string, userText: string): Promise<ChatReply> {
    const geminiKey = this.configService.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY;

    if (geminiKey) {
      try {
        const geminiReply = await this.callGeminiAssistant(userId, userText, geminiKey);
        if (geminiReply) {
          return {
            id: 'chat-' + Date.now(),
            sender: 'ai',
            text: geminiReply,
            timestamp: new Date().toISOString(),
          };
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gemini API call failed, falling back to rule-based reply: ${message}`);
      }
    }

    return this.generateRuleBasedReply(userId, userText);
  }

  /**
   * Scans a receipt/bill image using Gemini 1.5 Flash Vision.
   * Returns structured JSON: merchant, amount, category, date.
   */
  async scanBill(imageBase64: string, mimeType = 'image/jpeg'): Promise<ScannedBillResult> {
    const geminiKey = this.configService.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY;

    // Clean base64 string if it includes data URL prefix
    const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;

    if (geminiKey) {
      try {
        const result = await this.callGeminiVision(cleanBase64, mimeType, geminiKey);
        if (result) {
          return result;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gemini Vision scan failed, falling back to default draft: ${message}`);
      }
    }

    return {
      merchant: 'Receipt',
      amount: 0,
      category: 'Other',
      date: new Date().toISOString().split('T')[0],
    };
  }

  /**
   * Calls Google Gemini 1.5 Flash with live user financial context.
   */
  private async callGeminiAssistant(userId: string, userText: string, apiKey: string): Promise<string | null> {
    const { items, total } = await this.transactionsService.findAll(userId, {
      type: 'expense',
      page: 1,
      limit: 100,
    });

    const totalSpent = items.reduce((sum, tx) => sum + tx.amount, 0);
    const byCategory = new Map<string, number>();
    for (const tx of items) {
      byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + tx.amount);
    }
    const topCategories = [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_CATEGORY_COUNT)
      .map(([cat, amt]) => `${cat}: ${formatINR(amt)}`)
      .join(', ');

    const subs = await this.subscriptionsService.findAll(userId);
    const reminders = await this.remindersService.findAll(userId);
    const pendingReminders = reminders.filter((r) => r.status === 'pending').length;

    const systemPrompt = `You are TrackKaro AI, a warm, intelligent personal financial assistant for users in India.
Current user financial snapshot:
- Total recorded expenses: ${formatINR(totalSpent)} across ${total} transactions
- Top spending categories: ${topCategories || 'None recorded yet'}
- Active subscriptions: ${subs.length}
- Pending bill reminders: ${pendingReminders}

Guidelines:
1. Always use Indian Rupee (₹) and Indian currency conventions.
2. Keep replies concise, conversational, and direct (2-4 sentences or clean bullet points).
3. If asked about spending or budget, use the snapshot data.
4. If asked to find deals, suggest checking the Deals tab for Amazon/Flipkart/Myntra discounts.
5. Provide actionable, friendly saving tips without financial jargon.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userText }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 350,
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return candidateText?.trim() || null;
  }

  /**
   * Calls Google Gemini 1.5 Flash Vision to extract receipt data.
   */
  private async callGeminiVision(
    base64Data: string,
    mimeType: string,
    apiKey: string,
  ): Promise<ScannedBillResult | null> {
    const prompt = `Analyze this receipt, bill, or invoice image. Extract the following in strict JSON format:
{
  "merchant": "Vendor or store name",
  "amount": total numeric amount as a number,
  "category": "Food" | "Shopping" | "Bills" | "Fuel" | "Groceries" | "Entertainment" | "Health" | "Other",
  "date": "YYYY-MM-DD" (or today's date if not clearly visible)
}
Return ONLY valid JSON with no markdown wrapping or extra comments.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: mimeType || 'image/jpeg',
                  data: base64Data,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini Vision HTTP ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) return null;

    try {
      const parsed = JSON.parse(rawJson);
      return {
        merchant: String(parsed.merchant || 'Merchant Receipt'),
        amount: Number(parsed.amount) || 0,
        category: String(parsed.category || 'Other'),
        date: String(parsed.date || new Date().toISOString().split('T')[0]),
      };
    } catch {
      return null;
    }
  }

  /**
   * Fallback rule-based reply generator when GEMINI_API_KEY is not set or fails.
   */
  private async generateRuleBasedReply(userId: string, userText: string): Promise<ChatReply> {
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
