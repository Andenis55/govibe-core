import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, ReservationStatus } from '@prisma/client';
import { AUDIT_LOG_REPOSITORY } from '../../../audit/audit.tokens';
import { AuditLogRepository } from '../../../audit/domain/repositories/audit-log.repository.interface';
import {
  INVENTORY_REPOSITORY,
  RESERVATION_REPOSITORY,
} from '../../inventory.tokens';
import { InventoryRepository } from '../../domain/repositories/inventory.repository.interface';
import { ReservationRepository } from '../../domain/repositories/reservation.repository.interface';
import { AppLoggerService } from '../../../../shared/logging/logger.service';
import { NotFoundError } from '../../../../shared/errors/domain-errors';
import { OutboxRepository } from '../../../../shared/outbox/outbox.repository.interface';
import { OUTBOX_REPOSITORY } from '../../../../shared/outbox/outbox.tokens';
import { TransactionRunnerService } from '../../../../shared/prisma/transaction-runner.service';
import { TelemetryService } from '../../../../shared/telemetry/telemetry.service';

export type SweepExpiredReservationsInput = {
  limit?: number;
};

export type SweepExpiredReservationsResult = {
  swept: number;
  reservationIds: string[];
};

const DEFAULT_SWEEP_LIMIT = 100;

@Injectable()
export class SweepExpiredReservationsUseCase {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly logger: AppLoggerService,
    private readonly telemetry: TelemetryService,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: AuditLogRepository,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(
    input?: SweepExpiredReservationsInput,
  ): Promise<SweepExpiredReservationsResult> {
    const limit = input?.limit ?? DEFAULT_SWEEP_LIMIT;

    const result = await this.transactionRunner.runInTransaction(
      async (tx) => {
        const expiredReservations =
          await this.reservationRepository.claimExpiredHeldReservations(limit, tx);

        const reservationIds: string[] = [];

        for (const reservation of expiredReservations) {
          const inventory = await this.inventoryRepository.lockInventory(
            reservation.eventId,
            reservation.ticketTypeId,
            tx,
          );

          if (!inventory) {
            throw new NotFoundError('Inventory bucket not found for expired reservation.');
          }

          await this.reservationRepository.updateReservationStatus(
            reservation.id,
            ReservationStatus.EXPIRED,
            tx,
          );

          const liveReserved = await this.reservationRepository.getActiveReservationQuantity(
            reservation.eventId,
            reservation.ticketTypeId,
            tx,
          );

          await this.inventoryRepository.updateReservedCount(
            inventory.id,
            liveReserved,
            tx,
          );

          await this.auditLogRepository.append(
            {
              id: randomUUID(),
              actorId: null,
              action: 'RESERVATION_EXPIRED',
              entityType: 'ticket_reservation',
              entityId: reservation.id,
              correlationId: null,
              metadata: {
                eventId: reservation.eventId,
                ticketTypeId: reservation.ticketTypeId,
                quantity: reservation.quantity,
                expiresAt: reservation.expiresAt.toISOString(),
              },
            },
            tx,
          );

          await this.outboxRepository.append(
            {
              id: randomUUID(),
              aggregateType: 'ticket_reservation',
              aggregateId: reservation.id,
              eventType: 'TicketReservationExpired',
              payload: {
                reservationId: reservation.id,
                eventId: reservation.eventId,
                ticketTypeId: reservation.ticketTypeId,
                quantity: reservation.quantity,
              },
            },
            tx,
          );

          reservationIds.push(reservation.id);
        }

        return {
          swept: reservationIds.length,
          reservationIds,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
      },
    );

    if (result.swept > 0) {
      this.logger.log(
        `Swept ${result.swept} expired reservation(s).`,
        SweepExpiredReservationsUseCase.name,
      );
      this.telemetry.incrementCounter('inventory.expired_reservations.swept', result.swept);
    }

    return result;
  }
}