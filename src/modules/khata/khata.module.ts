import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { KhataEntry, KhataEntrySchema } from './schemas/khata-entry.schema';
import { KhataController } from './khata.controller';
import { KhataService } from './khata.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: KhataEntry.name, schema: KhataEntrySchema }])],
  controllers: [KhataController],
  providers: [KhataService],
  exports: [KhataService],
})
export class KhataModule {}
