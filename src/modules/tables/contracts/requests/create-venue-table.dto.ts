import { VenueTableStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVenueTableDto {
  @IsUUID()
  organizerId!: string;

  @IsOptional()
  @IsUUID()
  floorSectionId?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  seatCount!: number;

  @IsOptional()
  @IsEnum(VenueTableStatus)
  status?: VenueTableStatus;
}