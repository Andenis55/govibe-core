import { Injectable } from '@nestjs/common';
import { Prisma, TableReservation, TableReservationStatus } from '@prisma/client';
import {
  RepositoryOptions,
  resolveDbClient,
} from '../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../shared/prisma/prisma.service';

const reservationViewInclude = Prisma.validator<Prisma.TableReservationInclude>()({
  eventTable: {
    include: {
      venueTable: {
        select: {
          id: true,
          label: true,
          seatCount: true,
          floorSection: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  },
});

const reservationIdempotencySelect = Prisma.validator<Prisma.TableReservationSelect>()({
  id: true,
  actorUserId: true,
  organizerId: true,
  eventId: true,
  eventTableId: true,
  status: true,
  amountMinor: true,
  currency: true,
  idempotencyUseCase: true,
  idempotencyKeyHash: true,
  requestFingerprintHash: true,
  holdExpiresAt: true,
  cancelledAt: true,
  expiredAt: true,
  createdAt: true,
  updatedAt: true,
});

const activeHeldReservationSelect = Prisma.validator<Prisma.TableReservationSelect>()({
  id: true,
  holdExpiresAt: true,
});

export type TableReservationViewRecord = Prisma.TableReservationGetPayload<{
  include: typeof reservationViewInclude;
}>;

export type TableReservationIdempotencyRecord = Prisma.TableReservationGetPayload<{
  select: typeof reservationIdempotencySelect;
}>;

@Injectable()
export class TableReservationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByActorAndIdempotency(
    params: {
      actorUserId: string;
      idempotencyUseCase: string;
      idempotencyKeyHash: string;
    },
    options?: RepositoryOptions,
  ): Promise<TableReservationIdempotencyRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.tableReservation.findUnique({
      where: {
        actorUserId_idempotencyUseCase_idempotencyKeyHash: {
          actorUserId: params.actorUserId,
          idempotencyUseCase: params.idempotencyUseCase,
          idempotencyKeyHash: params.idempotencyKeyHash,
        },
      },
      select: reservationIdempotencySelect,
    });
  }

  create(
    data: Prisma.TableReservationUncheckedCreateInput,
    options?: RepositoryOptions,
  ): Promise<TableReservation> {
    const db = resolveDbClient(this.prisma, options);

    return db.tableReservation.create({ data });
  }

  findOwnedReservation(
    reservationId: string,
    actorUserId: string,
    options?: RepositoryOptions,
  ): Promise<TableReservationViewRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.tableReservation.findFirst({
      where: {
        id: reservationId,
        actorUserId,
      },
      include: reservationViewInclude,
    });
  }

  findReservationById(
    reservationId: string,
    options?: RepositoryOptions,
  ): Promise<TableReservationIdempotencyRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.tableReservation.findUnique({
      where: { id: reservationId },
      select: reservationIdempotencySelect,
    });
  }

  findExpiredHeldByEventTable(
    eventTableId: string,
    serverNow: Date,
    options?: RepositoryOptions,
  ): Promise<TableReservationIdempotencyRecord[]> {
    const db = resolveDbClient(this.prisma, options);

    return db.tableReservation.findMany({
      where: {
        eventTableId,
        status: TableReservationStatus.HELD,
        holdExpiresAt: {
          lte: serverNow,
        },
      },
      select: reservationIdempotencySelect,
      orderBy: { holdExpiresAt: 'asc' },
    });
  }

  findLatestActiveHeldReservationForEventTable(
    eventTableId: string,
    serverNow: Date,
    options?: RepositoryOptions,
  ) {
    const db = resolveDbClient(this.prisma, options);

    return db.tableReservation.findFirst({
      where: {
        eventTableId,
        status: TableReservationStatus.HELD,
        holdExpiresAt: {
          gt: serverNow,
        },
      },
      select: activeHeldReservationSelect,
      orderBy: { holdExpiresAt: 'desc' },
    });
  }

  countActiveHeldReservationsForEventTable(
    eventTableId: string,
    serverNow: Date,
    options?: RepositoryOptions,
  ): Promise<number> {
    const db = resolveDbClient(this.prisma, options);

    return db.tableReservation.count({
      where: {
        eventTableId,
        status: TableReservationStatus.HELD,
        holdExpiresAt: {
          gt: serverNow,
        },
      },
    });
  }

  markExpired(
    reservationId: string,
    expiredAt: Date,
    options?: RepositoryOptions,
  ) {
    const db = resolveDbClient(this.prisma, options);

    return db.tableReservation.update({
      where: { id: reservationId },
      data: {
        status: TableReservationStatus.EXPIRED,
        expiredAt,
      },
    });
  }
}