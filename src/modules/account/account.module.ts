import { Module } from '@nestjs/common';

import { BudgetsModule } from '@/modules/budgets/budgets.module';
import { DealsModule } from '@/modules/deals/deals.module';
import { GroupsModule } from '@/modules/groups/groups.module';
import { KhataModule } from '@/modules/khata/khata.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { RemindersModule } from '@/modules/reminders/reminders.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { TransactionsModule } from '@/modules/transactions/transactions.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [
    TransactionsModule,
    BudgetsModule,
    KhataModule,
    GroupsModule,
    RemindersModule,
    SubscriptionsModule,
    DealsModule,
    NotificationsModule,
  ],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
