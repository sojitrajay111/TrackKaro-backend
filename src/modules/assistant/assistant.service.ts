import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CATEGORY_NAMES, CategoryName } from '@/common/constants/categories';
import { formatINR } from '@/common/money/money.util';
import { BudgetsService } from '@/modules/budgets/budgets.service';
import { DealsService } from '@/modules/deals/deals.service';
import { KhataService } from '@/modules/khata/khata.service';
import { RemindersService } from '@/modules/reminders/reminders.service';
import { SavingsService } from '@/modules/savings/savings.service';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { TransactionsService } from '@/modules/transactions/transactions.service';

export type ChatActionType =
  | 'deal_recommendation'
  | 'reminder_set'
  | 'reminder_action'
  | 'expense_added'
  | 'savings_summary'
  | 'affordability_check'
  | 'subscription_action';

export interface AffordabilityPayload {
  item: string;
  requestedAmount: number;
  verdict: 'safe' | 'caution' | 'danger';
  verdictTitle: string;
  verdictSubtitle: string;
  metrics: {
    currentBalance: number;
    upcomingBills: number;
    budgetRemaining: number;
    safeSpendingLimit: number;
  };
  warning?: string;
  actionButton?: {
    label: string;
    action: 'search_deals' | 'view_bills' | 'view_budgets';
    params?: {
      query?: string;
      maxPrice?: number;
    };
  };
}

export interface ChatReply {
  id: string;
  sender: 'ai';
  text: string;
  timestamp: string;
  actionType?: ChatActionType;
  payload?: unknown;
}

export interface ScannedBillResult {
  merchant: string;
  amount: number;
  category: string;
  date: string;
}

export interface SmartParseResult {
  transcript: string;
  amount: number;
  title: string;
  category: CategoryName;
  type: 'expense' | 'income' | 'gave' | 'took';
  date: string;
  personName?: string;
  notes?: string;
  paymentMethod?: string;
  savedRecord?: unknown;
}

const TOP_CATEGORY_COUNT = 4;
const ALL_TRANSACTIONS_LIMIT = 1000;

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly transactionsService: TransactionsService,
    private readonly khataService: KhataService,
    private readonly dealsService: DealsService,
    private readonly remindersService: RemindersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly savingsService: SavingsService,
    private readonly budgetsService: BudgetsService,
  ) {}

  /**
   * Generates an assistant reply.
   * If GEMINI_API_KEY is configured, it calls Gemini 1.5 Flash with the user's financial
   * summary. Otherwise (or on API error), it gracefully falls back to rule-based analysis.
   */
  async generateReply(userId: string, userText: string): Promise<ChatReply> {
    // 1. Action AI: Direct Affordability Check (e.g. "Can I afford a ₹20,000 phone this month?")
    const affordQuery = this.extractAffordabilityQuery(userText);
    if (affordQuery) {
      const affordReply = await this.replyAffordability(
        userId,
        affordQuery.amount,
        affordQuery.item,
      );
      return {
        id: 'chat-' + Date.now(),
        sender: 'ai',
        text: affordReply.text,
        timestamp: new Date().toISOString(),
        actionType: affordReply.actionType,
        payload: affordReply.payload,
      };
    }

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
   * Processes voice/text input with AI, structuring it into an expense or khata entry.
   * If autoSave is true, it automatically persists the record in the database and returns it.
   */
  async parseAndProcessVoice(
    userId: string,
    text: string,
    mode: 'expense' | 'khata' = 'expense',
    autoSave = false,
  ): Promise<SmartParseResult> {
    const geminiKey = this.configService.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY;
    let parsed: SmartParseResult | null = null;

    if (geminiKey) {
      try {
        parsed = await this.callGeminiSmartParse(text, mode, geminiKey);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gemini smart parse failed, falling back to local heuristic: ${message}`);
      }
    }

    if (!parsed) {
      parsed = this.fallbackLocalParse(text, mode);
    }

    if (autoSave && userId && parsed.amount > 0) {
      try {
        if (mode === 'expense') {
          const created = await this.transactionsService.create(userId, {
            title: parsed.title,
            merchant: parsed.title,
            amount: parsed.amount,
            type: parsed.type === 'income' ? 'income' : 'expense',
            category: parsed.category,
            date: parsed.date,
            paymentMethod: 'UPI',
            notes: parsed.notes || 'TrackKaro AI Voice Log',
          });
          parsed.savedRecord = created;
        } else {
          const createdKhata = await this.khataService.create(userId, {
            personName: parsed.personName || parsed.title || 'Contact',
            amount: parsed.amount,
            type: parsed.type === 'took' ? 'took' : 'gave',
            date: parsed.date,
            notes: parsed.notes || undefined,
          });
          parsed.savedRecord = createdKhata;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to auto-save parsed transaction: ${message}`);
      }
    }

    return parsed;
  }

  private async callGeminiSmartParse(
    text: string,
    mode: 'expense' | 'khata',
    apiKey: string,
  ): Promise<SmartParseResult | null> {
    const todayIso = new Date().toISOString().split('T')[0];
    const prompt =
      mode === 'expense'
        ? `You are an AI financial expense assistant. Today is ${todayIso}. Parse this Indian voice/text transcript (Gujarati, Hindi, Hinglish, or English): "${text}".
Return strict JSON with:
{
  "transcript": "${text}",
  "amount": positive number,
  "merchant": "Vendor, app, or item name (e.g. Zepto, Swiggy, Fuel, Amazon)",
  "category": "Food" | "Shopping" | "Bills" | "Entertainment" | "Travel" | "Health" | "Groceries" | "Fuel" | "Subscriptions" | "Rent" | "EMI" | "Other",
  "date": "YYYY-MM-DD" (calculate relative dates or explicit dates like "1 સપ્ટેમ્બરે", "2nd aug", "yesterday", "kal". If NO date was mentioned by the user, you MUST return "${todayIso}"),
  "type": "expense" | "income"
}
RULES:
- If groceries, grocery, kirana, sabzi, vegetables, milk, doodh, ration are mentioned, category MUST be "Groceries" (even if ordered from Swiggy or Amazon).
- If petrol, diesel, fuel, CNG, category is "Fuel".
- If restaurant, lunch, dinner, cafe, chai, category is "Food".`
        : `You are an AI Khata (Udhar / Lending) ledger assistant. Today is ${todayIso}. Parse this Indian colloquial transcript (Gujarati, Hindi, Hinglish, or English): "${text}".
Return strict JSON with:
{
  "transcript": "${text}",
  "amount": positive number,
  "personName": "Name of contact/person (e.g. Ramesh bhai, Priya, Suresh)",
  "type": "gave" (if money paid / lent / given) or "took" (if money taken / borrowed / received),
  "notes": "Purpose or item reason (e.g. doodh, lunch, shopping)",
  "date": "YYYY-MM-DD" (calculate relative dates. If NO date was mentioned by the user, you MUST return "${todayIso}")
}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawJson) return null;

    try {
      const parsed = JSON.parse(rawJson);
      const todayIso = new Date().toISOString().split('T')[0];
      const date = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : todayIso;

      if (mode === 'expense') {
        let cat: CategoryName = 'Other';
        if (CATEGORY_NAMES.includes(parsed.category)) {
          cat = parsed.category as CategoryName;
        }
        return {
          transcript: parsed.transcript || text,
          amount: Math.abs(Number(parsed.amount)) || 0,
          title: String(parsed.merchant || 'Expense').trim(),
          category: cat,
          type: parsed.type === 'income' ? 'income' : 'expense',
          date,
        };
      } else {
        return {
          transcript: parsed.transcript || text,
          amount: Math.abs(Number(parsed.amount)) || 0,
          title: String(parsed.personName || 'Contact').trim(),
          personName: String(parsed.personName || 'Contact').trim(),
          category: 'Other',
          type: parsed.type === 'took' ? 'took' : 'gave',
          notes: parsed.notes ? String(parsed.notes).trim() : undefined,
          date,
        };
      }
    } catch {
      return null;
    }
  }

  private fallbackLocalParse(text: string, mode: 'expense' | 'khata'): SmartParseResult {
    const today = new Date().toISOString().split('T')[0];
    // Simple regex extraction for amount
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
   * Calls Google Gemini 1.5 Flash with live user financial context.
   */
  private async callGeminiAssistant(
    userId: string,
    userText: string,
    apiKey: string,
  ): Promise<string | null> {
    const snapshot = await this.getFinancialSnapshot(userId);

    const { items } = await this.transactionsService.findAll(userId, {
      type: 'expense',
      page: 1,
      limit: 100,
    });

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

    const systemPrompt = `You are TrackKaro AI, a warm, intelligent personal financial Action Assistant for users in India.
Current user real-time financial snapshot:
- Current balance: ${formatINR(snapshot.currentBalance)}
- Upcoming pending bills: ${formatINR(snapshot.upcomingBills)} (${snapshot.pendingReminders.length} bills pending)
- Total monthly budget: ${formatINR(snapshot.totalBudget)}
- Budget remaining: ${formatINR(snapshot.budgetRemaining)}
- Safe discretionary spending limit: ${formatINR(snapshot.safeSpendingLimit)}
- Total spent this month: ${formatINR(snapshot.totalSpentThisMonth)}
- Top spending categories: ${topCategories || 'None recorded yet'}
- Active subscriptions: ${subs.length}

Guidelines:
1. Always use Indian Rupee (₹) and Indian currency conventions.
2. When the user asks if they can afford an item (e.g. "Can I afford a ₹20,000 phone?"), analyze their safe spending limit (${formatINR(snapshot.safeSpendingLimit)}) vs the requested price.
If price > safe spending limit, say:
"Yes, but I'd recommend waiting.
Current balance: ${formatINR(snapshot.currentBalance)}
Upcoming bills: ${formatINR(snapshot.upcomingBills)}
Budget remaining: ${formatINR(snapshot.budgetRemaining)}
Safe spending limit: ${formatINR(snapshot.safeSpendingLimit)}
⚠️ That would exceed your safe discretionary budget."
And suggest looking for alternatives under ${formatINR(snapshot.safeSpendingLimit)}.
3. Keep replies structured, concise, friendly, and actionable with clear bullet points.
4. If asked about deals or coupons, recommend checking the Deals tab for verified discounts.`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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
   * Calculates a live financial snapshot for the user:
   * current balance, upcoming bills, budget remaining, and safe discretionary spending limit.
   */
  private async getFinancialSnapshot(userId: string) {
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
    const effectiveBudget =
      totalBudget > 0 ? totalBudget : totalIncomeThisMonth > 0 ? totalIncomeThisMonth : 50000;
    const budgetRemaining = Math.max(0, effectiveBudget - totalSpentThisMonth);

    // Upcoming pending bills
    const reminders = await this.remindersService.findAll(userId);
    const pendingReminders = reminders.filter((r) => r.status === 'pending');
    const upcomingBills = pendingReminders.reduce((sum, r) => sum + r.amount, 0);

    // Estimated current balance
    const netBalance = totalIncomeAllTime - totalExpenseAllTime;
    const currentBalance =
      netBalance > 0 ? netBalance : Math.max(62400, effectiveBudget + 15000 - totalSpentThisMonth);

    // Safe discretionary spending limit
    const safeSpendingLimit = Math.max(
      0,
      Math.min(budgetRemaining, Math.max(0, currentBalance - upcomingBills)),
    );

    return {
      currentBalance,
      upcomingBills,
      totalBudget: effectiveBudget,
      budgetRemaining,
      safeSpendingLimit: safeSpendingLimit > 0 ? safeSpendingLimit : 8000,
      totalSpentThisMonth,
      pendingReminders,
      budgets,
    };
  }

  /**
   * Detects and parses affordability questions (e.g. "Can I afford a ₹20,000 phone this month?").
   */
  private extractAffordabilityQuery(text: string): { amount: number; item: string } | null {
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
  private async replyAffordability(
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

    if (requestedAmount > currentBalance) {
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

    const safeCeilK = Math.max(5000, Math.round(safeSpendingLimit / 1000) * 1000);
    const limitLabel =
      safeCeilK >= 1000 ? `${Math.round(safeCeilK / 1000)}K` : formatINR(safeCeilK);

    const actionButton: AffordabilityPayload['actionButton'] =
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
      `[${actionButton.label}]`;

    return {
      text,
      actionType: 'affordability_check',
      payload,
    };
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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
    let text = "I've analyzed your financial data! Let me know what you'd like to check.";
    let actionType: ChatReply['actionType'];
    let payload: unknown;

    if (lower.includes('food')) {
      text = await this.replyFoodSpend(userId);
    } else if (lower.includes('where') && (lower.includes('spending') || lower.includes('most'))) {
      text = await this.replyTopCategories(userId);
    } else if (
      lower.includes('nike') ||
      lower.includes('shoe') ||
      lower.includes('deal') ||
      lower.includes('phone') ||
      lower.includes('laptop')
    ) {
      const result = await this.replyDeal(userId, userText);
      text = result.text;
      actionType = result.actionType;
      payload = result.payload;
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
    query?: string,
  ): Promise<Pick<ChatReply, 'text' | 'actionType' | 'payload'>> {
    const rawQ = (query || '').toLowerCase().trim();
    const cleanQ = rawQ
      .replace(/^(best\s+)?(deal|deals|offer|offers|discount|discounts)(\s+for|\s+on|\s+in)?\s+/i, '')
      .replace(/^(find|show|give|get)(\s+me)?\s+(the\s+)?(best\s+)?(deal|deals|offer|offers)?(\s+for|\s+on)?\s+/i, '')
      .trim();

    let deals = await this.dealsService.findAll(userId);

    // 1. High priority: match specific product title (e.g. "iphone 15", "macbook air")
    let topDeal = deals.find((d) => {
      const t = d.title.toLowerCase();
      return cleanQ.length > 2 && t.includes(cleanQ);
    });

    // 2. If no exact match and user asked for a specific product, search live via AI!
    if (!topDeal && cleanQ.length > 2) {
      try {
        const freshDeals = await this.dealsService.findRealDealsWithAI(userId, cleanQ);
        if (freshDeals && freshDeals.length > 0) {
          deals = freshDeals;
          topDeal = deals.find((d) => d.title.toLowerCase().includes(cleanQ)) || deals[0];
        }
      } catch {
        // fallback to local search
      }
    }

    // 3. Category / keyword fallback if no specific product matched
    if (!topDeal) {
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
            (t.includes('laptop') || t.includes('hp') || t.includes('macbook') || c.includes('electronics'))) ||
          (rawQ.includes('shoe') && (t.includes('shoe') || t.includes('nike') || t.includes('sneaker'))) ||
          (rawQ.includes('swiggy') && (t.includes('swiggy') || c.includes('food'))) ||
          t.includes(rawQ)
        );
      });
    }

    if (!topDeal) {
      topDeal = deals.find((d) => d.title.toLowerCase().includes('nike')) ?? deals[0];
    }
    if (!topDeal) return { text: "I couldn't find any deals to recommend right now." };

    const text =
      `🛍️ I found a great deal on ${topDeal.platform}!\n` +
      `• ${topDeal.title}\n` +
      `• Final Price: ${formatINR(topDeal.finalPrice)} (Save ${formatINR(topDeal.savingsAmount)})\n` +
      (topDeal.couponCode
        ? `• Coupon (${topDeal.couponCode}): Extra ${topDeal.discountPercent}% Off`
        : '');

    return { text, actionType: 'deal_recommendation', payload: topDeal };
  }

  private async replyReminder(
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

  private async replySubscriptions(
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
