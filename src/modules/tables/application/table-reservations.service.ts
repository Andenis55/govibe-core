import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventStatus,
  EventTableStatus,
  OrganizerStatus,
  Prisma,
  TableReservationStatus,
  VenueTableStatus,
} from '@prisma/client';
import { AppConfigService } from '../../../shared/config/config.service';
import { TransactionRunnerService } from '../../../shared/prisma/transaction-runner.service';
import { TxClient } from '../../../shared/prisma/prisma.types';
import {
  TableReservationResponseDto,
} from '../contracts/responses/table-reservation-response.dto';
import { TableAuditService } from './table-audit.service';
import {
  TABLE_HOLD_IDEMPOTENCY_USE_CASE,
  TableIdempotencyService,
} from './table-idempotency.service';
import { TableReservationsRepository } from '../infrastructure/table-reservations.repository';
import { LockedEventTableRecord, TablesRepository } from '../infrastructure/tables.repository';

const DEFAULT_TABLE_HOLD_DURATION_SECONDS = 600;
const MIN_TABLE_HOLD_DURATION_SECONDS = 60;
const MAX_TABLE_HOLD_DURATION_SECONDS = 1800;

type HoldRejectionContext = {
  actorUserId: string;
  eventId: string;
  eventTableId: string;
  organizerId?: string | null;
  venueTableId?: string | null;
  reason: string;
};

class HoldRejectionError extends Error {
  constructor(
    readonly statusCode: 403 | 404 | 409,
    message: string,
    readonly context: HoldRejectionContext,
  ) {
    super(message);
  }
}

@Injectable()
export class TableReservationsService {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly configService: AppConfigService,
    private readonly tables: TablesRepository,
    private readonly reservations: TableReservationsRepository,
    private readonly tableAudit: TableAuditService,
    private readonly idempotency: TableIdempotencyService,
  ) {}

  async createHold(input: {
    actorUserId: string;
    eventId: string;
    eventTableId: string;
    idempotencyKey: string;
  }): Promise<TableReservationResponseDto> {
    const now = new Date();
    const normalizedIdempotencyKey = input.idempotencyKey.trim();

    if (!normalizedIdempotencyKey) {
      throw new BadRequestException('idempotencyKey is required');
    }

    const idempotencyKeyHash = this.idempotency.hashIdempotencyKey(
      normalizedIdempotencyKey,
    );
    const requestFingerprintHash =
      this.idempotency.buildHoldRequestFingerprintHash({
        eventId: input.eventId,
        eventTableId: input.eventTableId,
      });
    const holdDurationSeconds = this.resolveHoldDurationSeconds();

    try {
      const reservation = await this.transactionRunner.runInTransaction(
        async (tx) => {
          const locked = await this.tables.lockEventTableForUpdate(
            tx,
            input.eventTableId,
          );

          if (!locked) {
            throw new HoldRejectionError(404, 'event table not found', {
              actorUserId: input.actorUserId,
              eventId: input.eventId,
              eventTableId: input.eventTableId,
              reason: 'event_table_not_found',
            });
          }

          const eventTable = await this.tables.findLockedEventTableDetails(
            tx,
            input.eventTableId,
          );

          if (!eventTable || eventTable.eventId !== input.eventId) {
            throw new HoldRejectionError(404, 'event table not found', {
              actorUserId: input.actorUserId,
              eventId: input.eventId,
              eventTableId: input.eventTableId,
              organizerId: eventTable?.organizerId ?? null,
              venueTableId: eventTable?.venueTableId ?? null,
              reason: 'event_table_not_found',
            });
          }

          this.assertHoldEligible(eventTable, input.actorUserId, now);

          const existing = await this.reservations.findByActorAndIdempotency(
            {
              actorUserId: input.actorUserId,
              idempotencyUseCase: TABLE_HOLD_IDEMPOTENCY_USE_CASE,
              idempotencyKeyHash,
            },
            { tx },
          );

          if (existing) {
            if (existing.requestFingerprintHash !== requestFingerprintHash) {
              throw new HoldRejectionError(
                409,
                'idempotency key reused with different payload',
                {
                  actorUserId: input.actorUserId,
                  organizerId: eventTable.organizerId,
                  eventId: input.eventId,
                  eventTableId: input.eventTableId,
                  venueTableId: eventTable.venueTableId,
                  reason: 'idempotency_fingerprint_mismatch',
                },
              );
            }

            await this.expireStaleHoldForEventTableWithinTx(
              tx,
              eventTable.id,
              now,
            );

            const replay = await this.reservations.findOwnedReservation(
              existing.id,
              input.actorUserId,
              { tx },
            );

            if (!replay) {
              throw new NotFoundException('table reservation not found');
            }

            return replay;
          }

          await this.expireStaleHoldForEventTableWithinTx(tx, eventTable.id, now);

          const activeCount =
            await this.reservations.countActiveHeldReservationsForEventTable(
              eventTable.id,
              now,
              { tx },
            );

          if (activeCount > 0) {
            throw new HoldRejectionError(409, 'table is already held', {
              actorUserId: input.actorUserId,
              organizerId: eventTable.organizerId,
              eventId: input.eventId,
              eventTableId: input.eventTableId,
              venueTableId: eventTable.venueTableId,
              reason: 'table_already_held',
            });
          }

          const holdExpiresAt = new Date(
            now.getTime() + holdDurationSeconds * 1000,
          );

          let created = null;

          try {
            created = await this.reservations.create(
              {
                actorUserId: input.actorUserId,
                organizerId: eventTable.organizerId,
                eventId: eventTable.eventId,
                eventTableId: eventTable.id,
                status: TableReservationStatus.HELD,
                amountMinor: eventTable.priceMinor,
                currency: eventTable.currency,
                idempotencyUseCase: TABLE_HOLD_IDEMPOTENCY_USE_CASE,
                idempotencyKeyHash,
                requestFingerprintHash,
                holdExpiresAt,
              },
              { tx },
            );
          } catch (error) {
            if (
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            ) {
              const replay = await this.reservations.findByActorAndIdempotency(
                {
                  actorUserId: input.actorUserId,
                  idempotencyUseCase: TABLE_HOLD_IDEMPOTENCY_USE_CASE,
                  idempotencyKeyHash,
                },
                { tx },
              );

              if (replay?.requestFingerprintHash === requestFingerprintHash) {
                const existingReplay = await this.reservations.findOwnedReservation(
                  replay.id,
                  input.actorUserId,
                  { tx },
                );

                if (existingReplay) {
                  return existingReplay;
                }
              }

              throw new HoldRejectionError(
                409,
                'idempotency key reused with different payload',
                {
                  actorUserId: input.actorUserId,
                  organizerId: eventTable.organizerId,
                  eventId: input.eventId,
                  eventTableId: input.eventTableId,
                  venueTableId: eventTable.venueTableId,
                  reason: 'idempotency_conflict',
                },
              );
            }

            throw error;
          }

          await this.tables.updateEventTableState(
            eventTable.id,
            {
              status: EventTableStatus.HELD,
              holdExpiresAt,
            },
            { tx },
          );

          await this.tableAudit.logHoldCreated(
            {
              actorUserId: input.actorUserId,
              organizerId: eventTable.organizerId,
              eventId: eventTable.eventId,
              venueTableId: eventTable.venueTableId,
              eventTableId: eventTable.id,
              reservationId: created.id,
              amountMinor: created.amountMinor,
              currency: created.currency,
              holdExpiresAt,
            },
            { tx },
          );

          const reservation = await this.reservations.findOwnedReservation(
            created.id,
            input.actorUserId,
            { tx },
          );

          if (!reservation) {
            throw new NotFoundException('table reservation not found');
          }

          return reservation;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15000,
        },
      );

      return this.toReservationResponse(reservation);
    } catch (error) {
      if (error instanceof HoldRejectionError) {
        await this.tableAudit.logReservationRejected({
          actorUserId: error.context.actorUserId,
          organizerId: error.context.organizerId ?? null,
          eventId: error.context.eventId,
          venueTableId: error.context.venueTableId ?? null,
          eventTableId: error.context.eventTableId,
          reason: error.context.reason,
        });

        throw this.toHttpException(error);
      }

      throw error;
    }
  }

  async getOwnedReservation(
    reservationId: string,
    actorUserId: string,
  ): Promise<TableReservationResponseDto> {
    const now = new Date();

    const reservation = await this.transactionRunner.runInTransaction(
      async (tx) => {
        const existing = await this.reservations.findOwnedReservation(
          reservationId,
          actorUserId,
          { tx },
        );

        if (!existing) {
          throw new NotFoundException('table reservation not found');
        }

        if (
          existing.status === TableReservationStatus.HELD &&
          existing.holdExpiresAt <= now
        ) {
          await this.expireStaleHoldForEventTableWithinTx(
            tx,
            existing.eventTableId,
            now,
          );
        } else {
          await this.reconcileEventTableStateWithinTx(
            tx,
            existing.eventTableId,
            now,
          );
        }

        const refreshed = await this.reservations.findOwnedReservation(
          reservationId,
          actorUserId,
          { tx },
        );

        if (!refreshed) {
          throw new NotFoundException('table reservation not found');
        }

        return refreshed;
      },
      {
        timeout: 10000,
      },
    );

    return this.toReservationResponse(reservation);
  }

  async expireStaleHoldForEventTableWithinTx(
    tx: TxClient,
    eventTableId: string,
    serverNow: Date,
  ): Promise<void> {
    const eventTableState = await this.tables.findEventTableState(eventTableId, {
      tx,
    });

    if (!eventTableState) {
      return;
    }

    const expiredReservations = await this.reservations.findExpiredHeldByEventTable(
      eventTableId,
      serverNow,
      { tx },
    );

    for (const reservation of expiredReservations) {
      await this.reservations.markExpired(reservation.id, serverNow, { tx });
    }

    const previousStatus = eventTableState.status;
    const nextState = await this.reconcileEventTableStateWithinTx(
      tx,
      eventTableId,
      serverNow,
      eventTableState,
    );

    for (const reservation of expiredReservations) {
      await this.tableAudit.logHoldExpired(
        {
          actorUserId: reservation.actorUserId,
          organizerId: reservation.organizerId,
          eventId: reservation.eventId,
          eventTableId: reservation.eventTableId,
          reservationId: reservation.id,
          holdExpiresAt: reservation.holdExpiresAt,
          expiredAt: serverNow,
          previousEventTableStatus: previousStatus,
          newEventTableStatus: nextState.status,
        },
        { tx },
      );
    }
  }

  countActiveHeldReservationsForEventTable(
    tx: TxClient,
    eventTableId: string,
    serverNow: Date,
  ): Promise<number> {
    return this.reservations.countActiveHeldReservationsForEventTable(
      eventTableId,
      serverNow,
      { tx },
    );
  }

  private assertHoldEligible(
    eventTable: LockedEventTableRecord,
    actorUserId: string,
    serverNow: Date,
  ): void {
    if (eventTable.event.status !== EventStatus.PUBLISHED) {
      throw new HoldRejectionError(403, 'event is not available for table holds', {
        actorUserId,
        organizerId: eventTable.organizerId,
        eventId: eventTable.eventId,
        eventTableId: eventTable.id,
        venueTableId: eventTable.venueTableId,
        reason: 'event_not_published',
      });
    }

    if (eventTable.event.endsAt <= serverNow) {
      throw new HoldRejectionError(403, 'event has ended', {
        actorUserId,
        organizerId: eventTable.organizerId,
        eventId: eventTable.eventId,
        eventTableId: eventTable.id,
        venueTableId: eventTable.venueTableId,
        reason: 'event_ended',
      });
    }

    if (eventTable.event.visibility !== 'PUBLIC') {
      throw new HoldRejectionError(403, 'event is not customer facing', {
        actorUserId,
        organizerId: eventTable.organizerId,
        eventId: eventTable.eventId,
        eventTableId: eventTable.id,
        venueTableId: eventTable.venueTableId,
        reason: 'event_not_customer_facing',
      });
    }

    if (eventTable.organizer.status !== OrganizerStatus.APPROVED) {
      throw new HoldRejectionError(403, 'organizer is not approved', {
        actorUserId,
        organizerId: eventTable.organizerId,
        eventId: eventTable.eventId,
        eventTableId: eventTable.id,
        venueTableId: eventTable.venueTableId,
        reason: 'organizer_not_approved',
      });
    }

    if (eventTable.venueTable.organizerId !== eventTable.organizerId) {
      throw new HoldRejectionError(409, 'venue table organizer mismatch', {
        actorUserId,
        organizerId: eventTable.organizerId,
        eventId: eventTable.eventId,
        eventTableId: eventTable.id,
        venueTableId: eventTable.venueTableId,
        reason: 'venue_table_organizer_mismatch',
      });
    }

    if (eventTable.event.organizerId !== eventTable.organizerId) {
      throw new HoldRejectionError(409, 'event organizer mismatch', {
        actorUserId,
        organizerId: eventTable.organizerId,
        eventId: eventTable.eventId,
        eventTableId: eventTable.id,
        venueTableId: eventTable.venueTableId,
        reason: 'event_organizer_mismatch',
      });
    }

    if (eventTable.venueTable.status !== VenueTableStatus.ACTIVE) {
      throw new HoldRejectionError(409, 'venue table is unavailable', {
        actorUserId,
        organizerId: eventTable.organizerId,
        eventId: eventTable.eventId,
        eventTableId: eventTable.id,
        venueTableId: eventTable.venueTableId,
        reason: 'venue_table_unavailable',
      });
    }

    if (eventTable.status === EventTableStatus.UNAVAILABLE) {
      throw new HoldRejectionError(409, 'event table is unavailable', {
        actorUserId,
        organizerId: eventTable.organizerId,
        eventId: eventTable.eventId,
        eventTableId: eventTable.id,
        venueTableId: eventTable.venueTableId,
        reason: 'event_table_unavailable',
      });
    }
  }

  private async reconcileEventTableStateWithinTx(
    tx: TxClient,
    eventTableId: string,
    serverNow: Date,
    currentState?: {
      status: EventTableStatus;
      holdExpiresAt: Date | null;
    } | null,
  ): Promise<{ status: EventTableStatus; holdExpiresAt: Date | null }> {
    const state =
      currentState ?? (await this.tables.findEventTableState(eventTableId, { tx }));

    if (!state) {
      throw new NotFoundException('event table not found');
    }

    const activeHold =
      await this.reservations.findLatestActiveHeldReservationForEventTable(
        eventTableId,
        serverNow,
        { tx },
      );

    let nextStatus = state.status;
    let nextHoldExpiresAt = state.holdExpiresAt;

    if (activeHold) {
      nextStatus = EventTableStatus.HELD;
      nextHoldExpiresAt = activeHold.holdExpiresAt;
    } else if (state.status === EventTableStatus.HELD) {
      nextStatus = EventTableStatus.AVAILABLE;
      nextHoldExpiresAt = null;
    } else if (state.holdExpiresAt !== null) {
      nextHoldExpiresAt = null;
    }

    const changed =
      nextStatus !== state.status ||
      nextHoldExpiresAt?.getTime() !== state.holdExpiresAt?.getTime();

    if (changed) {
      await this.tables.updateEventTableState(
        eventTableId,
        {
          status: nextStatus,
          holdExpiresAt: nextHoldExpiresAt,
        },
        { tx },
      );
    }

    return {
      status: nextStatus,
      holdExpiresAt: nextHoldExpiresAt,
    };
  }

  private resolveHoldDurationSeconds(): number {
    const rawValue = this.configService.getOptional('TABLE_HOLD_DURATION_SECONDS');

    if (rawValue === undefined || rawValue === null || rawValue === '') {
      return DEFAULT_TABLE_HOLD_DURATION_SECONDS;
    }

    const parsed =
      typeof rawValue === 'number' ? rawValue : Number(String(rawValue));

    if (
      !Number.isInteger(parsed) ||
      parsed < MIN_TABLE_HOLD_DURATION_SECONDS ||
      parsed > MAX_TABLE_HOLD_DURATION_SECONDS
    ) {
      return DEFAULT_TABLE_HOLD_DURATION_SECONDS;
    }

    return parsed;
  }

  private toReservationResponse(
    reservation: import('../infrastructure/table-reservations.repository').TableReservationViewRecord,
  ): TableReservationResponseDto {
    return {
      id: reservation.id,
      eventId: reservation.eventId,
      eventTableId: reservation.eventTableId,
      venueTableId: reservation.eventTable.venueTable.id,
      label: reservation.eventTable.venueTable.label,
      floorSectionName:
        reservation.eventTable.venueTable.floorSection?.name ?? null,
      seatCount: reservation.eventTable.venueTable.seatCount,
      amountMinor: reservation.amountMinor,
      currency: reservation.currency,
      status: reservation.status,
      holdExpiresAt: reservation.holdExpiresAt,
      cancelledAt: reservation.cancelledAt,
      expiredAt: reservation.expiredAt,
      createdAt: reservation.createdAt,
      updatedAt: reservation.updatedAt,
    };
  }

  private toHttpException(error: HoldRejectionError): Error {
    if (error.statusCode === 403) {
      return new ForbiddenException(error.message);
    }

    if (error.statusCode === 404) {
      return new NotFoundException(error.message);
    }

    return new ConflictException(error.message);
  }
}