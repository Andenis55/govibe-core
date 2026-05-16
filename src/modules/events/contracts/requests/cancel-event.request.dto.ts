import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelEventRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}