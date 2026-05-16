import { TableReservationStatus } from '@prisma/client';

export class TableReservationResponseDto {
  id!: string;
  eventId!: string;
  eventTableId!: string;
  venueTableId!: string;
  label!: string;
  floorSectionName!: string | null;
  seatCount!: number;
  amountMinor!: number;
  currency!: string;
  status!: TableReservationStatus;
  holdExpiresAt!: Date;
  cancelledAt!: Date | null;
  expiredAt!: Date | null;
  createdAt!: Date;
  updatedAt!: Date;
}