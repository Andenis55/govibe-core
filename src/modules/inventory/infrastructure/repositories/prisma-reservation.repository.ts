import { Injectable } from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';
import {
  ReservationRepository,
} from '../../domain/repositories/reservation.repository.interface';
import { CreateHeldReservationInput } from '../../domain/types/inventory.types';
import { TxClient } from '../../../../shared/prisma/prisma.types';

@Injectable()
export class PrismaReservationRepository implements ReservationRepository {
  async createHeldReservation(
    input: CreateHeldReservationInput,
    tx: TxClient,
  ): Promise<void> {
    await tx.ticketReservation.create({
      data: {
        id: input.id,
        ownerUserId: input.ownerUserId,
        eventId: input.eventId,
        ticketTypeId: input.ticketTypeId,
        quantity: input.quantity,
        status: ReservationStatus.HELD,
        expiresAt: input.expiresAt,
      },
    });
  }

  async claimExpiredHeldReservations(
    limit: number,
    tx: TxClient,
  ) {
    return tx.$queryRaw<Array<{
      id: string;
      ownerUserId: string;
      eventId: string;
      ticketTypeId: string;
      quantity: number;
      status: ReservationStatus;
      expiresAt: Date;
    }>>(Prisma.sql`
      SELECT
        id,
        owner_user_id AS "ownerUserId",
        event_id AS "eventId",
        ticket_type_id AS "ticketTypeId",
        quantity,
        status,
        expires_at AS "expiresAt"
      FROM ticket_reservations
      WHERE status = 'HELD'
        AND expires_at <= NOW()
      ORDER BY expires_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    `);
  }

  async getActiveReservationQuantity(
    eventId: string,
    ticketTypeId: string,
    tx: TxClient,
  ): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ total: bigint | null }>>(Prisma.sql`
      SELECT COALESCE(SUM(quantity), 0) AS total
      FROM ticket_reservations
      WHERE event_id = ${eventId}::uuid
        AND ticket_type_id = ${ticketTypeId}::uuid
        AND status = 'HELD'
        AND expires_at > NOW()
    `);

    return Number(rows[0]?.total ?? 0n);
  }

  async updateReservationStatus(
    reservationId: string,
    status: ReservationStatus,
    tx: TxClient,
  ): Promise<void> {
    await tx.ticketReservation.update({
      where: { id: reservationId },
      data: { status },
    });
  }

  async findById(
    reservationId: string,
    tx: TxClient,
  ) {
    return tx.ticketReservation.findUnique({
      where: { id: reservationId },
      select: {
        id: true,
        ownerUserId: true,
        eventId: true,
        ticketTypeId: true,
        quantity: true,
        status: true,
        expiresAt: true,
      },
    });
  }
}
