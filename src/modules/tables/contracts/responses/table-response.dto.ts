import { VenueTableStatus } from '@prisma/client';

export class TableResponseDto {
  id!: string;
  organizerId!: string;
  floorSectionId!: string | null;
  floorSectionName!: string | null;
  label!: string;
  seatCount!: number;
  status!: VenueTableStatus;
  createdAt!: Date;
  updatedAt!: Date;
}