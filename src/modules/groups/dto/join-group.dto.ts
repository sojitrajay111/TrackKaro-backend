import { IsOptional, IsString, MinLength } from 'class-validator';

export class JoinGroupDto {
  @IsString()
  @MinLength(4)
  inviteCode!: string;

  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsString()
  memberName?: string;
}
