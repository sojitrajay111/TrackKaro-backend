import { Module } from '@nestjs/common';

import { BudgetsModule } from '@/modules/budgets/budgets.module';
import { DealsModule } from '@/modules/deals/deals.module';
import { KhataModule } from '@/modules/khata/khata.module';
import { RemindersModule } from '@/modules/reminders/reminders.module';
import { SavingsModule } from '@/modules/savings/savings.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { TransactionsModule } from '@/modules/transactions/transactions.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { BillOcrService } from './services/bill-ocr.service';
import { GeminiOrchestratorService } from './services/gemini-orchestrator.service';
import { RuleBasedAssistantService } from './services/rule-based-assistant.service';

@Module({
  imports: [
    TransactionsModule,
    KhataModule,
    DealsModule,
    RemindersModule,
    SubscriptionsModule,
    SavingsModule,
    BudgetsModule,
  ],
  controllers: [AssistantController],
  providers: [
    AssistantService,
    BillOcrService,
    RuleBasedAssistantService,
    GeminiOrchestratorService,
  ],
  exports: [AssistantService, BillOcrService, RuleBasedAssistantService, GeminiOrchestratorService],
})
export class AssistantModule {}
