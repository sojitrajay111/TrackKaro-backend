import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { NotificationsModule } from '@/modules/notifications/notifications.module';
import { DealsController } from './deals.controller';
import { DealsService } from './deals.service';
import { Deal, DealSchema } from './schemas/deal.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Deal.name, schema: DealSchema }]),
    NotificationsModule,
  ],
  controllers: [DealsController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
