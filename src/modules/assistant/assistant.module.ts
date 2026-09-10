import { Module } from '@nestjs/common';

import { DealsModule } from '@/modules/deals/deals.module';
import { RemindersModule } from '@/modules/reminders/reminders.module';
import { SavingsModule } from '@/modules/savings/savings.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { TransactionsModule } from '@/modules/transactions/transactions.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [TransactionsModule, DealsModule, RemindersModule, SubscriptionsModule, SavingsModule],
  controllers: [AssistantController],
  providers: [AssistantService],
})
export class AssistantModule {}
