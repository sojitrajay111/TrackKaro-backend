import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { ExpenseGroup, ExpenseGroupSchema } from './schemas/expense-group.schema';
import { GroupExpense, GroupExpenseSchema } from './schemas/group-expense.schema';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { DebtSimplificationService } from './services/debt-simplification.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExpenseGroup.name, schema: ExpenseGroupSchema },
      { name: GroupExpense.name, schema: GroupExpenseSchema },
    ]),
  ],
  controllers: [GroupsController],
  providers: [GroupsService, DebtSimplificationService],
  exports: [GroupsService],
})
export class GroupsModule {}
