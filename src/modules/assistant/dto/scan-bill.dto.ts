import { IsOptional, IsString, MinLength } from 'class-validator';

export class ScanBillDto {
  @IsString()
  @MinLength(20)
  imageBase64!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}
