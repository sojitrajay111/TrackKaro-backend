import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  text!: string;

  /** The user's local date (YYYY-MM-DD), so "tomorrow" means their tomorrow. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  today?: string;
}
