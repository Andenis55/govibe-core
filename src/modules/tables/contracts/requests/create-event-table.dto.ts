import { EventTableStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateEventTableDto {
  @IsUUID()
  organizerId!: string;

  @IsUUID()
  eventId!: string;

  @IsUUID()
  venueTableId!: string;

  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  priceMinor!: number;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;

  @IsOptional()
  @IsEnum(EventTableStatus)
  status?: EventTableStatus;
}