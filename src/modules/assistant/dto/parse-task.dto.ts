import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** The user's local date (the device knows it; the server's UTC date can be a day off in India). */
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export class ParseTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  text!: string;

  @IsOptional()
  @Matches(DATE_KEY)
  today?: string;

  /** Also create the task (used by voice shortcuts); the task form only wants the fields. */
  @IsOptional()
  @IsBoolean()
  autoSave?: boolean;
}

export const AUDIO_MIME_TYPES = [
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/wav',
] as const;

export class TranscribeDto {
  /** Base64 audio (no data: prefix). ~1 minute of the app's 32 kbps recording is ~320 KB. */
  @IsString()
  @MinLength(100)
  @MaxLength(3_500_000)
  audioBase64!: string;

  /** Browsers add parameters ("audio/webm;codecs=opus"); only the base type is checked and kept. */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : value,
  )
  @IsIn(AUDIO_MIME_TYPES)
  mimeType?: (typeof AUDIO_MIME_TYPES)[number];
}
