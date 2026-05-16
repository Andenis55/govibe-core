import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ScanTicketDto {
  @IsUUID()
  ticketId!: string;

  @IsString()
  @MinLength(32)
  @MaxLength(512)
  token!: string;

  @IsOptional()
  @IsUUID()
  eventId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  gateLabel?: string;
}