import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { BillReminder, BillReminderSchema } from './schemas/bill-reminder.schema';
import { RemindersController } from './reminders.controller';
import { RemindersService } from './reminders.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: BillReminder.name, schema: BillReminderSchema }])],
  controllers: [RemindersController],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
