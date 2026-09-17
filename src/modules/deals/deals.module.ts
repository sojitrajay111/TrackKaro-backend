import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BudgetsModule } from '@/modules/budgets/budgets.module';
import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { RemindersModule } from '@/modules/reminders/reminders.module';
import { TransactionsModule } from '@/modules/transactions/transactions.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { Deal, DealSchema } from './schemas/deal.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Deal.name, schema: DealSchema }]),
    NotificationsModule,
    TransactionsModule,
    BudgetsModule,
    RemindersModule,
  ],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
