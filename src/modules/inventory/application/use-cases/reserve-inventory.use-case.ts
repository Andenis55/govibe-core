import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InventoryRepository } from '../../domain/repositories/inventory.repository.interface';
import { ReservationRepository } from '../../domain/repositories/reservation.repository.interface';
import {
  INVENTORY_REPOSITORY,
  RESERVATION_REPOSITORY,
} from '../../inventory.tokens';
import { AUDIT_LOG_REPOSITORY } from '../../../audit/audit.tokens';
import { AuditLogRepository } from '../../../audit/domain/repositories/audit-log.repository.interface';
import { RequestContextService } from '../../../../shared/context/request-context.service';
import {
  DomainConflictError,
  InventoryUnavailableError,
  NotFoundError,
} from '../../../../shared/errors/domain-errors';
import { OutboxRepository } from '../../../../shared/outbox/outbox.repository.interface';
import { OUTBOX_REPOSITORY } from '../../../../shared/outbox/outbox.tokens';
import { TransactionRunnerService } from '../../../../shared/prisma/transaction-runner.service';

export type ReserveInventoryInput = {
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  holdTtlSeconds: number;
};

export type ReserveInventoryResult = {
  reservationId: string;
  expiresAt: Date;
  quantity: number;
};

@Injectable()
export class ReserveInventoryUseCase {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly requestContext: RequestContextService,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: AuditLogRepository,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(input: ReserveInventoryInput): Promise<ReserveInventoryResult> {
    if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
      throw new DomainConflictError('Reservation quantity must be a positive integer.');
    }

    if (!Number.isInteger(input.holdTtlSeconds) || input.holdTtlSeconds <= 0) {
      throw new DomainConflictError('Hold TTL must be a positive integer.');
    }

    const ctx = this.requestContext.get();

    if (!ctx?.userId) {
      throw new DomainConflictError('Authenticated user context is required.');
    }

    const actorUserId = ctx.userId;

    return this.transactionRunner.runInTransaction(
      async (tx) => {
        const inventory = await this.inventoryRepository.lockInventory(
          input.eventId,
          input.ticketTypeId,
          tx,
        );

        if (!inventory) {
          throw new NotFoundError('Inventory bucket not found.');
        }

        const cachedAvailable =
          inventory.capacityTotal - inventory.reservedCount - inventory.soldCount;
        const isTight =
          cachedAvailable <= Math.max(Math.floor(inventory.capacityTotal * 0.05), 50);

        const authoritativeReserved = isTight
          ? await this.reservationRepository.getActiveReservationQuantity(
              input.eventId,
              input.ticketTypeId,
              tx,
            )
          : inventory.reservedCount;

        const available =
          inventory.capacityTotal - authoritativeReserved - inventory.soldCount;

        if (input.quantity > available) {
          throw new InventoryUnavailableError('Not enough tickets available.');
        }

        const reservationId = randomUUID();
        const expiresAt = new Date(Date.now() + input.holdTtlSeconds * 1000);
        const newReservedCount = authoritativeReserved + input.quantity;

        await this.reservationRepository.createHeldReservation(
          {
            id: reservationId,
            ownerUserId: actorUserId,
            eventId: input.eventId,
            ticketTypeId: input.ticketTypeId,
            quantity: input.quantity,
            expiresAt,
          },
          tx,
        );

        await this.inventoryRepository.updateReservedCount(
          inventory.id,
          newReservedCount,
          tx,
        );

        await this.auditLogRepository.append(
          {
            id: randomUUID(),
            actorId: ctx?.userId ?? null,
            action: 'INVENTORY_RESERVED',
            entityType: 'ticket_reservation',
            entityId: reservationId,
            correlationId: ctx?.correlationId,
            metadata: {
              eventId: input.eventId,
              ticketTypeId: input.ticketTypeId,
              quantity: input.quantity,
              expiresAt: expiresAt.toISOString(),
            },
          },
          tx,
        );

        await this.outboxRepository.append(
          {
            id: randomUUID(),
            aggregateType: 'ticket_reservation',
            aggregateId: reservationId,
            eventType: 'TicketReservationCreated',
            payload: {
              reservationId,
              eventId: input.eventId,
              ticketTypeId: input.ticketTypeId,
              quantity: input.quantity,
              expiresAt: expiresAt.toISOString(),
            },
          },
          tx,
        );

        return {
          reservationId,
          expiresAt,
          quantity: input.quantity,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );
  }
}
