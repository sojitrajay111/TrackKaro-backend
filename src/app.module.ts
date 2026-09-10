import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import configuration from '@/config/configuration';
import { validate } from '@/config/env.validation';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { DatabaseModule } from '@/database/database.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { BudgetsModule } from '@/modules/budgets/budgets.module';
import { HealthModule } from '@/modules/health/health.module';
import { AccountModule } from '@/modules/account/account.module';
import { AssistantModule } from '@/modules/assistant/assistant.module';
import { DealsModule } from '@/modules/deals/deals.module';
import { GroupsModule } from '@/modules/groups/groups.module';
import { KhataModule } from '@/modules/khata/khata.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { RemindersModule } from '@/modules/reminders/reminders.module';
import { SavingsModule } from '@/modules/savings/savings.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { TransactionsModule } from '@/modules/transactions/transactions.module';
import { UsersModule } from '@/modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate,
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    DatabaseModule,
    HealthModule,
    UsersModule,
    AuthModule,
    NotificationsModule,
    BudgetsModule,
    TransactionsModule,
    RemindersModule,
    SubscriptionsModule,
    SavingsModule,
    KhataModule,
    GroupsModule,
    DealsModule,
    AssistantModule,
    AccountModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Every route requires a valid access token by default; use @Public() to opt out
    // (see auth.controller.ts and health.controller.ts).
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
