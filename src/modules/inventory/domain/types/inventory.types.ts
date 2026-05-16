import { ReservationStatus } from '@prisma/client';

export type LockedInventoryRecord = {
  id: string;
  eventId: string;
  ticketTypeId: string;
  capacityTotal: number;
  reservedCount: number;
  soldCount: number;
};

export type CreateHeldReservationInput = {
  id: string;
  ownerUserId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  expiresAt: Date;
};

export type ReservationRecord = {
  id: string;
  ownerUserId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  status: ReservationStatus;
  expiresAt: Date;
};