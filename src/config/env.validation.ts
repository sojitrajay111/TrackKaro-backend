import { Type, plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

class EnvironmentVariables {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65535)
  PORT = 4000;

  @IsString()
  MONGO_URI!: string;

  @IsString()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_ACCESS_TTL = '15m';

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  JWT_REFRESH_TTL = '30d';

  @IsString()
  CORS_ORIGINS = '';

  @IsOptional()
  @IsString()
  GEMINI_API_KEY?: string;

  @IsOptional()
  @IsString()
  OPENAI_API_KEY?: string;

  @IsOptional()
  @IsString()
  EMAIL_USER?: string;

  @IsOptional()
  @IsString()
  EMAIL_PASSCODE?: string;

  @IsOptional()
  @IsIn(['provider', 'legacy'])
  DEALS_ENGINE_MODE?: string;

  @IsOptional()
  @IsString()
  FLIPKART_AFFILIATE_ID?: string;

  @IsOptional()
  @IsString()
  FLIPKART_AFFILIATE_TOKEN?: string;
}

/** Validates process.env at bootstrap so a misconfigured deploy fails fast instead of at first request. */
export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Config validation error: ${errors.toString()}`);
  }
  return validated;
}
