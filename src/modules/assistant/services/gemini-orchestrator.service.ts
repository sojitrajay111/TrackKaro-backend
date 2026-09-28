import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CATEGORY_NAMES, CategoryName } from '@/common/constants/categories';
import { formatINR } from '@/common/money/money.util';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { TransactionsService } from '@/modules/transactions/transactions.service';
import { SmartParseResult } from '../types';
import { RuleBasedAssistantService } from './rule-based-assistant.service';

const TOP_CATEGORY_COUNT = 4;

@Injectable()
export class GeminiOrchestratorService {
  private readonly logger = new Logger(GeminiOrchestratorService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly transactionsService: TransactionsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly ruleBasedService: RuleBasedAssistantService,
  ) {}

  /**
   * Orchestrates LLM reply by trying OpenAI if configured, then Gemini.
   */
  async generateModelReply(userId: string, userText: string): Promise<string | null> {
    const openaiKey = this.configService.get<string>('openaiApiKey') || process.env.OPENAI_API_KEY;
    const geminiKey = this.configService.get<string>('geminiApiKey') || process.env.GEMINI_API_KEY;

    if (openaiKey) {
      try {
        const openaiReply = await this.callOpenAIAssistant(userId, userText, openaiKey);
        if (openaiReply) {
          return openaiReply;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`OpenAI Assistant call failed, falling back to Gemini: ${message}`);
      }
    }

    if (geminiKey) {
      try {
        const geminiReply = await this.callGeminiAssistant(userId, userText, geminiKey);
        if (geminiReply) {
          return geminiReply;
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gemini API call failed, falling back to rule-based reply: ${message}`);
      }
    }

    return null;
  }

  /**
   * Calls OpenAI GPT-4o-mini with live user financial context.
   */
  async callOpenAIAssistant(
    userId: string,
    userText: string,
    apiKey: string,
  ): Promise<string | null> {
    const systemPrompt = await this.buildFinancialSystemPrompt(userId);

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`OpenAI HTTP ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const candidateText = data?.choices?.[0]?.message?.content;
    return candidateText?.trim() || null;
  }

  /**
   * Calls Google Gemini Flash model with live user financial context.
   */
  async callGeminiAssistant(
    userId: string,
    userText: string,
    apiKey: string,
  ): Promise<string | null> {
    const systemPrompt = await this.buildFinancialSystemPrompt(userId);

    const candidateModels = ['gemini-3.6-flash', 'gemini-2.5-flash'];
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
              maxOutputTokens: 1024,
            },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (candidateText?.trim()) {
            return candidateText.trim();
          }
        } else {
          this.logger.warn(`Gemini (${model}) Assistant HTTP ${res.status}`);
        }
      } catch (err) {
        this.logger.warn(`Gemini (${model}) Assistant error: ${err}`);
      }
    }

    return null;
  }

  /**
   * Calls Gemini to parse Indian colloquial voice transcripts.
   */
  async callGeminiSmartParse(
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

    const candidateModels = ['gemini-3.6-flash', 'gemini-2.5-flash'];
    for (const model of candidateModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
          continue;
        }

        const data = await res.json();
        const rawJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawJson) continue;

        const parsed = JSON.parse(rawJson);
        const date =
          parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : todayIso;

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
        continue;
      }
    }
    return null;
  }

  private async buildFinancialSystemPrompt(userId: string): Promise<string> {
    const snapshot = await this.ruleBasedService.getFinancialSnapshot(userId);

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

    return `You are TrackKaro AI, a warm, intelligent personal financial Action Assistant for users in India.
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
2. If the user has ₹0 recorded expenses or ₹0 balance, explicitly state that no transactions are recorded yet and politely guide them to log their income or expenses using the '+' button. Never output broken bullet lists or empty summaries.
3. When the user asks if they can afford an item (e.g. "Can I afford a ₹20,000 phone?"), analyze their safe spending limit (${formatINR(snapshot.safeSpendingLimit)}) vs the requested price.
4. Keep replies structured, concise, friendly, and complete with clear bullet points.
5. If asked about external shopping deals, product discounts, or live market prices, guide the user to check Amazon/Flipkart/Google or explore the Deals tab, and remind them of TrackKaro's personal finance capabilities.`;
  }
}
