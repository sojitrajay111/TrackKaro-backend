import { Injectable, Logger } from '@nestjs/common';

import { KhataService } from '@/modules/khata/khata.service';
import { TransactionsService } from '@/modules/transactions/transactions.service';
import {
  AffordabilityPayload,
  ChatActionType,
  ChatReply,
  FinancialSnapshot,
  ScannedBillResult,
  SmartParseResult,
} from './types';
import { BillOcrService } from './services/bill-ocr.service';
import { GeminiOrchestratorService } from './services/gemini-orchestrator.service';
import { RuleBasedAssistantService } from './services/rule-based-assistant.service';

export {
  AffordabilityPayload,
  ChatActionType,
  ChatReply,
  FinancialSnapshot,
  ScannedBillResult,
  SmartParseResult,
};

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly khataService: KhataService,
    private readonly billOcrService: BillOcrService,
    private readonly ruleBasedService: RuleBasedAssistantService,
    private readonly geminiOrchestratorService: GeminiOrchestratorService,
  ) {}

  /**
   * Generates an assistant reply.
   * Dispatches direct intent checks (affordability, price queries, safe limits, reminders, etc.)
   * or orchestrates LLM completion via OpenAI/Gemini with rule-based fallback.
   */
  async generateReply(userId: string, userText: string): Promise<ChatReply> {
    // 1. Action AI: Direct Affordability Check (e.g. "Can I afford a ₹20,000 phone this month?")
    const affordQuery = this.ruleBasedService.extractAffordabilityQuery(userText);
    if (affordQuery) {
      const affordReply = await this.ruleBasedService.replyAffordability(
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

    const lower = userText.toLowerCase();

    // 2. Shopping / Deals / Market Price Lookup Boundary:
    const isShoppingOrPriceQuery =
      lower.includes('deal') ||
      lower.includes('discount') ||
      lower.includes('coupon') ||
      lower.includes('offer') ||
      lower.includes('price') ||
      lower.includes('cost') ||
      lower.includes('rate') ||
      lower.includes('how much') ||
      lower.includes('best price') ||
      lower.includes('cheapest') ||
      lower.includes('samsung') ||
      lower.includes('iphone') ||
      lower.includes('macbook') ||
      lower.includes('laptop');

    if (isShoppingOrPriceQuery && !lower.includes('afford') && !lower.includes('spend')) {
      const guideText = await this.ruleBasedService.replyPriceLookupGuide(userId);
      return {
        id: 'chat-' + Date.now(),
        sender: 'ai',
        text: guideText,
        timestamp: new Date().toISOString(),
      };
    }

    // 3. Action AI: Safe Discretionary Spending Limit
    const isSafeSpendQuery =
      lower.includes('safely spend') ||
      lower.includes('safe to spend') ||
      lower.includes('safe spend') ||
      lower.includes('how much can i spend') ||
      lower.includes('spending limit') ||
      lower.includes('how much money can i spend');

    if (isSafeSpendQuery) {
      const safeSpendReply = await this.ruleBasedService.replySafeSpend(userId);
      return {
        id: 'chat-' + Date.now(),
        sender: 'ai',
        text: safeSpendReply,
        timestamp: new Date().toISOString(),
      };
    }

    // 4. Action AI: Spending Breakdown / Expense Analysis
    const isSpendingAnalysisQuery =
      lower.includes('analyze my spending') ||
      lower.includes('spending breakdown') ||
      lower.includes('show my spending') ||
      lower.includes('my spending this month') ||
      lower.includes('expenses this month') ||
      lower.includes('spending this month') ||
      lower.includes('expense report') ||
      lower.includes('how much did i spend');

    if (isSpendingAnalysisQuery) {
      const spendingReply = await this.ruleBasedService.replySpendingSummary(userId);
      return {
        id: 'chat-' + Date.now(),
        sender: 'ai',
        text: spendingReply,
        timestamp: new Date().toISOString(),
      };
    }

    // 5. Action AI: Bill Reminders & Dues
    const isReminderQuery =
      lower.includes('remind') ||
      lower.includes('bill due') ||
      lower.includes('pending bill') ||
      lower.includes('upcoming bill') ||
      lower.includes('bill reminder');

    if (isReminderQuery) {
      const reminderReply = await this.ruleBasedService.replyReminder(userId);
      if (reminderReply && reminderReply.actionType) {
        return {
          id: 'chat-' + Date.now(),
          sender: 'ai',
          text: reminderReply.text,
          timestamp: new Date().toISOString(),
          actionType: reminderReply.actionType,
          payload: reminderReply.payload,
        };
      }
    }

    // 6. Action AI: Subscription Audit
    const isSubscriptionQuery =
      lower.includes('subscription') ||
      lower.includes('duplicate sub') ||
      lower.includes('unused sub');

    if (isSubscriptionQuery) {
      const subReply = await this.ruleBasedService.replySubscriptions(userId);
      if (subReply && subReply.actionType) {
        return {
          id: 'chat-' + Date.now(),
          sender: 'ai',
          text: subReply.text,
          timestamp: new Date().toISOString(),
          actionType: subReply.actionType,
          payload: subReply.payload,
        };
      }
    }

    // 7. Orchestrate LLM reply with live financial prompt
    const modelReply = await this.geminiOrchestratorService.generateModelReply(userId, userText);
    if (modelReply) {
      return {
        id: 'chat-' + Date.now(),
        sender: 'ai',
        text: modelReply,
        timestamp: new Date().toISOString(),
      };
    }

    // 8. Deterministic rule-based fallback
    return this.ruleBasedService.generateRuleBasedReply(userId, userText);
  }

  /**
   * Scans a receipt/bill image using Gemini 1.5 Flash Vision.
   */
  async scanBill(imageBase64: string, mimeType = 'image/jpeg'): Promise<ScannedBillResult> {
    return this.billOcrService.scanBill(imageBase64, mimeType);
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
    let parsed: SmartParseResult | null = null;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (geminiKey) {
      try {
        parsed = await this.geminiOrchestratorService.callGeminiSmartParse(text, mode, geminiKey);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Gemini smart parse failed, falling back to local heuristic: ${message}`);
      }
    }

    if (!parsed) {
      parsed = this.ruleBasedService.fallbackLocalParse(text, mode);
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
}
