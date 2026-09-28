import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { AssistantService } from './assistant.service';
import { BillOcrService } from './services/bill-ocr.service';
import { GeminiOrchestratorService } from './services/gemini-orchestrator.service';
import { RuleBasedAssistantService } from './services/rule-based-assistant.service';
import { TransactionsService } from '@/modules/transactions/transactions.service';
import { KhataService } from '@/modules/khata/khata.service';
import { DealsService } from '@/modules/deals/deals.service';
import { RemindersService } from '@/modules/reminders/reminders.service';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { SavingsService } from '@/modules/savings/savings.service';
import { BudgetsService } from '@/modules/budgets/budgets.service';

describe('Assistant Modular Services', () => {
  let assistantService: AssistantService;
  let billOcrService: BillOcrService;
  let ruleBasedService: RuleBasedAssistantService;
  let geminiOrchestratorService: GeminiOrchestratorService;

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'geminiApiKey') return undefined;
      if (key === 'openaiApiKey') return undefined;
      return undefined;
    }),
  };

  const mockTransactionsService = {
    findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    create: jest.fn().mockResolvedValue({ id: 'tx-1' }),
  };

  const mockKhataService = {
    findAll: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({ id: 'khata-1' }),
  };

  const mockDealsService = {
    findAll: jest.fn().mockResolvedValue([]),
    discoverDeals: jest.fn().mockResolvedValue([]),
  };

  const mockRemindersService = {
    findAll: jest.fn().mockResolvedValue([]),
  };

  const mockSubscriptionsService = {
    findAll: jest.fn().mockResolvedValue([]),
  };

  const mockSavingsService = {
    getFullMetrics: jest.fn().mockResolvedValue({
      totalSaved: 0,
      dealSavings: 0,
      couponSavings: 0,
      cashback: 0,
      avoidedExpenses: 0,
    }),
  };

  const mockBudgetsService = {
    findAll: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssistantService,
        BillOcrService,
        RuleBasedAssistantService,
        GeminiOrchestratorService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: TransactionsService, useValue: mockTransactionsService },
        { provide: KhataService, useValue: mockKhataService },
        { provide: DealsService, useValue: mockDealsService },
        { provide: RemindersService, useValue: mockRemindersService },
        { provide: SubscriptionsService, useValue: mockSubscriptionsService },
        { provide: SavingsService, useValue: mockSavingsService },
        { provide: BudgetsService, useValue: mockBudgetsService },
      ],
    }).compile();

    assistantService = module.get<AssistantService>(AssistantService);
    billOcrService = module.get<BillOcrService>(BillOcrService);
    ruleBasedService = module.get<RuleBasedAssistantService>(RuleBasedAssistantService);
    geminiOrchestratorService = module.get<GeminiOrchestratorService>(GeminiOrchestratorService);
  });

  describe('BillOcrService', () => {
    it('returns default draft when no GEMINI_API_KEY is configured', async () => {
      const result = await billOcrService.scanBill('data:image/jpeg;base64,ZmFrZQ==');
      expect(result.merchant).toBe('Receipt');
      expect(result.amount).toBe(0);
      expect(result.category).toBe('Other');
      expect(result.date).toBeDefined();
    });
  });

  describe('RuleBasedAssistantService', () => {
    it('extracts affordability queries correctly', () => {
      const q1 = ruleBasedService.extractAffordabilityQuery('Can I afford a ₹25,000 phone?');
      expect(q1).toEqual({ amount: 25000, item: 'phone' });

      const q2 = ruleBasedService.extractAffordabilityQuery('Should I buy a 50k laptop?');
      expect(q2).toEqual({ amount: 50000, item: 'laptop' });

      const q3 = ruleBasedService.extractAffordabilityQuery('What is my spending?');
      expect(q3).toBeNull();
    });

    it('falls back to local heuristic parsing for voice transcripts', () => {
      const parsed = ruleBasedService.fallbackLocalParse('Swiggy dinner 450 rupees', 'expense');
      expect(parsed.amount).toBe(450);
      expect(parsed.category).toBe('Food');
      expect(parsed.type).toBe('expense');
    });
  });

  describe('AssistantService Facade', () => {
    it('handles direct affordability check', async () => {
      const reply = await assistantService.generateReply('user-1', 'Can I afford a ₹10,000 phone?');
      expect(reply.actionType).toBe('affordability_check');
      expect(reply.payload).toBeDefined();
      expect(reply.text).toContain('Current balance');
    });

    it('guides user for external market price searches', async () => {
      const reply = await assistantService.generateReply('user-1', 'What is the best price for iPhone 15?');
      expect(reply.text).toContain('TrackKaro is your Personal Finance & Budget Assistant');
    });

    it('delegates scanBill to BillOcrService', async () => {
      const result = await assistantService.scanBill('ZmFrZQ==');
      expect(result.merchant).toBe('Receipt');
      expect(result.amount).toBe(0);
    });

    it('processes voice transcripts with fallback heuristic', async () => {
      const result = await assistantService.parseAndProcessVoice('user-1', 'Zepto groceries 350', 'expense', false);
      expect(result.amount).toBe(350);
      expect(result.category).toBe('Groceries');
      expect(result.title).toBe('Zepto');
    });
  });
});
