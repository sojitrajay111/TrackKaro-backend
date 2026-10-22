import { PartialType } from '@nestjs/mapped-types';

import { CreateKhataEntryDto } from './create-khata-entry.dto';

/** Edit an existing entry (amount, type, dates, notes, person, phone, status); every field optional. */
export class UpdateKhataEntryDto extends PartialType(CreateKhataEntryDto) {}
