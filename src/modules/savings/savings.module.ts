import { Module } from '@nestjs/common';

import { DealsModule } from '@/modules/deals/deals.module';
import { SubscriptionsModule } from '@/modules/subscriptions/subscriptions.module';
import { SavingsController } from './savings.controller';
import { SavingsService } from './savings.service';

@Module({
  imports: [SubscriptionsModule, DealsModule],
  controllers: [SavingsController],
  providers: [SavingsService],
  exports: [SavingsService],
})
export class SavingsModule {}
