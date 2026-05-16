import { ReservationStatus } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';
import {
  CreateHeldReservationInput,
  ReservationRecord,
} from '../types/inventory.types';

export interface ReservationRepository {
  createHeldReservation(
    input: CreateHeldReservationInput,
    tx: TxClient,
  ): Promise<void>;

  claimExpiredHeldReservations(
    limit: number,
    tx: TxClient,
  ): Promise<ReservationRecord[]>;

  getActiveReservationQuantity(
    eventId: string,
    ticketTypeId: string,
    tx: TxClient,
  ): Promise<number>;

  updateReservationStatus(
    reservationId: string,
    status: ReservationStatus,
    tx: TxClient,
  ): Promise<void>;

  findById(
    reservationId: string,
    tx: TxClient,
  ): Promise<ReservationRecord | null>;
}
