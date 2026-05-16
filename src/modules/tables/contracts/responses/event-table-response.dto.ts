import { EventTableStatus } from '@prisma/client';

export class EventTableResponseDto {
  id!: string;
  organizerId!: string;
  eventId!: string;
  venueTableId!: string;
  label!: string;
  floorSectionName!: string | null;
  seatCount!: number;
  priceMinor!: number;
  currency!: string;
  status!: EventTableStatus;
  holdExpiresAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}