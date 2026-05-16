import { Injectable } from '@nestjs/common';
import { Prisma, TableAuditEvent } from '@prisma/client';
import {
  RepositoryOptions,
  resolveDbClient,
} from '../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../shared/prisma/prisma.service';

@Injectable()
export class TableAuditService {
  constructor(private readonly prisma: PrismaService) {}

  async append(
    input: {
      actorUserId?: string | null;
      organizerId?: string | null;
      eventId?: string | null;
      venueTableId?: string | null;
      eventTableId?: string | null;
      reservationId?: string | null;
      event: TableAuditEvent;
      reason?: string | null;
      metadata?: Record<string, unknown> | null;
    },
    options?: RepositoryOptions,
  ): Promise<void> {
    const db = resolveDbClient(this.prisma, options);

    await db.tableAuditLog.create({
      data: {
        actorUserId: input.actorUserId ?? null,
        organizerId: input.organizerId ?? null,
        eventId: input.eventId ?? null,
        venueTableId: input.venueTableId ?? null,
        eventTableId: input.eventTableId ?? null,
        reservationId: input.reservationId ?? null,
        event: input.event,
        reason: input.reason ?? null,
        metadata: input.metadata
          ? this.toJsonValue(input.metadata)
          : Prisma.JsonNull,
      },
    });
  }

  logVenueTableCreated(
    input: {
      actorUserId: string;
      organizerId: string;
      venueTableId: string;
      floorSectionId?: string | null;
      label: string;
      seatCount: number;
      status: string;
    },
    options?: RepositoryOptions,
  ): Promise<void> {
    return this.append(
      {
        actorUserId: input.actorUserId,
        organizerId: input.organizerId,
        venueTableId: input.venueTableId,
        event: TableAuditEvent.VENUE_TABLE_CREATED,
        metadata: {
          venueTableId: input.venueTableId,
          organizerId: input.organizerId,
          floorSectionId: input.floorSectionId ?? null,
          label: input.label,
          seatCount: input.seatCount,
          status: input.status,
        },
      },
      options,
    );
  }

  logEventTableCreated(
    input: {
      actorUserId: string;
      organizerId: string;
      eventId: string;
      eventTableId: string;
      venueTableId: string;
      priceMinor: number;
      currency: string;
      status: string;
    },
    options?: RepositoryOptions,
  ): Promise<void> {
    return this.append(
      {
        actorUserId: input.actorUserId,
        organizerId: input.organizerId,
        eventId: input.eventId,
        venueTableId: input.venueTableId,
        eventTableId: input.eventTableId,
        event: TableAuditEvent.EVENT_TABLE_CREATED,
        metadata: {
          organizerId: input.organizerId,
          eventId: input.eventId,
          eventTableId: input.eventTableId,
          venueTableId: input.venueTableId,
          priceMinor: input.priceMinor,
          currency: input.currency,
          status: input.status,
        },
      },
      options,
    );
  }

  logEventTableUpdated(
    input: {
      actorUserId: string;
      organizerId: string;
      eventId: string;
      eventTableId: string;
      venueTableId: string;
      previousStatus: string;
      newStatus: string;
    },
    options?: RepositoryOptions,
  ): Promise<void> {
    return this.append(
      {
        actorUserId: input.actorUserId,
        organizerId: input.organizerId,
        eventId: input.eventId,
        venueTableId: input.venueTableId,
        eventTableId: input.eventTableId,
        event: TableAuditEvent.EVENT_TABLE_UPDATED,
        metadata: {
          organizerId: input.organizerId,
          eventId: input.eventId,
          eventTableId: input.eventTableId,
          venueTableId: input.venueTableId,
          previousStatus: input.previousStatus,
          newStatus: input.newStatus,
        },
      },
      options,
    );
  }

  logHoldCreated(
    input: {
      actorUserId: string;
      organizerId: string;
      eventId: string;
      venueTableId: string;
      eventTableId: string;
      reservationId: string;
      amountMinor: number;
      currency: string;
      holdExpiresAt: Date;
    },
    options?: RepositoryOptions,
  ): Promise<void> {
    return this.append(
      {
        actorUserId: input.actorUserId,
        organizerId: input.organizerId,
        eventId: input.eventId,
        venueTableId: input.venueTableId,
        eventTableId: input.eventTableId,
        reservationId: input.reservationId,
        event: TableAuditEvent.TABLE_HOLD_CREATED,
        metadata: {
          reservationId: input.reservationId,
          eventTableId: input.eventTableId,
          eventId: input.eventId,
          organizerId: input.organizerId,
          amountMinor: input.amountMinor,
          currency: input.currency,
          holdExpiresAt: input.holdExpiresAt.toISOString(),
        },
      },
      options,
    );
  }

  logHoldExpired(
    input: {
      actorUserId?: string | null;
      organizerId: string;
      eventId: string;
      eventTableId: string;
      reservationId: string;
      holdExpiresAt: Date;
      expiredAt: Date;
      previousEventTableStatus?: string;
      newEventTableStatus?: string;
    },
    options?: RepositoryOptions,
  ): Promise<void> {
    return this.append(
      {
        actorUserId: input.actorUserId ?? null,
        organizerId: input.organizerId,
        eventId: input.eventId,
        eventTableId: input.eventTableId,
        reservationId: input.reservationId,
        event: TableAuditEvent.TABLE_HOLD_EXPIRED,
        reason: 'hold_expired',
        metadata: {
          reservationId: input.reservationId,
          eventTableId: input.eventTableId,
          eventId: input.eventId,
          organizerId: input.organizerId,
          reason: 'hold_expired',
          previousReservationStatus: 'HELD',
          newReservationStatus: 'EXPIRED',
          previousEventTableStatus: input.previousEventTableStatus,
          newEventTableStatus: input.newEventTableStatus,
          expiredAt: input.expiredAt.toISOString(),
          holdExpiresAt: input.holdExpiresAt.toISOString(),
        },
      },
      options,
    );
  }

  logReservationRejected(
    input: {
      actorUserId: string;
      organizerId?: string | null;
      eventId?: string | null;
      venueTableId?: string | null;
      eventTableId?: string | null;
      reason: string;
      metadata?: Record<string, unknown> | null;
    },
    options?: RepositoryOptions,
  ): Promise<void> {
    return this.append(
      {
        actorUserId: input.actorUserId,
        organizerId: input.organizerId ?? null,
        eventId: input.eventId ?? null,
        venueTableId: input.venueTableId ?? null,
        eventTableId: input.eventTableId ?? null,
        event: TableAuditEvent.TABLE_RESERVATION_REJECTED,
        reason: input.reason,
        metadata: {
          organizerId: input.organizerId ?? null,
          eventId: input.eventId ?? null,
          venueTableId: input.venueTableId ?? null,
          eventTableId: input.eventTableId ?? null,
          reason: input.reason,
          ...(input.metadata ?? {}),
        },
      },
      options,
    );
  }

  private toJsonValue(value: Record<string, unknown>): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }
}