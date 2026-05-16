import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SubmitOrganizerRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}