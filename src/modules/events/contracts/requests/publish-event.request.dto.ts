import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PublishEventRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}