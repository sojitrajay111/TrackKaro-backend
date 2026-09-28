import { CategoryName } from '@/common/constants/categories';

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

export interface FinancialSnapshot {
  currentBalance: number;
  upcomingBills: number;
  totalBudget: number;
  budgetRemaining: number;
  safeSpendingLimit: number;
  totalSpentThisMonth: number;
  totalIncomeThisMonth: number;
  pendingReminders: Array<{
    id?: string;
    title: string;
    amount: number;
    dueDate: string;
    status: string;
  }>;
  budgets: Array<{ id?: string; category: string; limit: number }>;
}
