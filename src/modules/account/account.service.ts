import { Injectable } from '@nestjs/common';

import { BudgetsService } from '@/modules/budgets/budgets.service';
import { DealsService } from '@/modules/deals/deals.service';
import { GroupsService } from '@/modules/groups/groups.service';
import { KhataService } from '@/modules/khata/khata.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import { RemindersService } from '@/modules/reminders/reminders.service';
import { SubscriptionsService } from '@/modules/subscriptions/subscriptions.service';
import { TransactionsService } from '@/modules/transactions/transactions.service';

/**
 * Orchestrates account-wide actions that span every domain at once — currently just the
 * "wipe all my data" action (Settings screen). Deliberately does not touch the user's account
 * itself (email/password) — only the financial data owned by it.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly budgetsService: BudgetsService,
    private readonly khataService: KhataService,
    private readonly groupsService: GroupsService,
    private readonly remindersService: RemindersService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly dealsService: DealsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async deleteAllData(userId: string): Promise<void> {
    await Promise.all([
      this.transactionsService.deleteAllForUser(userId),
      this.budgetsService.deleteAllForUser(userId),
      this.khataService.deleteAllForUser(userId),
      this.groupsService.deleteAllForUser(userId),
      this.remindersService.deleteAllForUser(userId),
      this.subscriptionsService.deleteAllForUser(userId),
      this.dealsService.deleteAllForUser(userId),
      this.notificationsService.clearAll(userId),
    ]);
  }
}
