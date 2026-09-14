import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SmartParseDto {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsIn(['expense', 'khata'])
  mode?: 'expense' | 'khata';

  @IsOptional()
  @IsBoolean()
  autoSave?: boolean;
}
