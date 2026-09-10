import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { Transaction, TransactionSchema } from '@/modules/transactions/schemas/transaction.schema';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';
import { CategoryBudget, CategoryBudgetSchema } from './schemas/category-budget.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CategoryBudget.name, schema: CategoryBudgetSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [BudgetsController],
  providers: [BudgetsService],
  exports: [BudgetsService],
})
export class BudgetsModule {}
