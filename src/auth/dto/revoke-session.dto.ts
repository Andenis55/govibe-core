import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RevokeSessionDto {
  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}