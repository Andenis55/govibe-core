import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { OrderStatus, Prisma, ReservationStatus } from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '../../../audit/audit.tokens';
import { AuditLogRepository } from '../../../audit/domain/repositories/audit-log.repository.interface';
import { RESERVATION_REPOSITORY } from '../../../inventory/inventory.tokens';
import { ReservationRepository } from '../../../inventory/domain/repositories/reservation.repository.interface';
import { IDEMPOTENCY_REPOSITORY } from '../../../idempotency/idempotency.tokens';
import { IdempotencyRepository } from '../../../idempotency/domain/repositories/idempotency.repository.interface';
import { ORDER_REPOSITORY } from '../../orders.tokens';
import { OrderRepository } from '../../domain/repositories/order.repository.interface';
import { RequestContextService } from '../../../../shared/context/request-context.service';
import {
  DomainConflictError,
  IdempotencyConflictError,
  InvalidStateTransitionError,
  NotFoundError,
} from '../../../../shared/errors/domain-errors';
import { LaunchControlService } from '../../../../shared/launch-control/launch-control.service';
import { OutboxRepository } from '../../../../shared/outbox/outbox.repository.interface';
import { OUTBOX_REPOSITORY } from '../../../../shared/outbox/outbox.tokens';
import { TransactionRunnerService } from '../../../../shared/prisma/transaction-runner.service';

export type CreateOrderInput = {
  idempotencyKey: string;
  reservationId: string;
  totalAmount: bigint;
  currency: string;
};

export type CreateOrderResult = {
  orderId: string;
  status: OrderStatus;
};

const CHECKOUT_IDEMPOTENCY_USE_CASE = 'checkout.create_order';

@Injectable()
export class CreateOrderUseCase {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly requestContext: RequestContextService,
    private readonly launchControl: LaunchControlService,
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    @Inject(IDEMPOTENCY_REPOSITORY)
    private readonly idempotencyRepository: IdempotencyRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: AuditLogRepository,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(input: CreateOrderInput): Promise<CreateOrderResult> {
    const ctx = this.requestContext.get();

    if (!ctx?.userId) {
      throw new DomainConflictError('Authenticated user context is required.');
    }

    const actorId = ctx.userId;
    const correlationId = ctx.correlationId;

    return this.transactionRunner.runInTransaction(
      async (tx) => {
        const requestHash = createHash('sha256')
          .update(
            JSON.stringify(input, (_key, value: unknown) =>
              typeof value === 'bigint' ? value.toString() : value,
            ),
          )
          .digest('hex');
        const idempotencyScope = {
          actorUserId: actorId,
          useCase: CHECKOUT_IDEMPOTENCY_USE_CASE,
          idempotencyKey: input.idempotencyKey,
        };

        const claimed = await this.idempotencyRepository.tryCreatePending(
          {
            ...idempotencyScope,
            requestHash,
          },
          tx,
        );

        let existingIdempotency:
          | {
              actorUserId: string;
              useCase: string;
              idempotencyKeyHash: string;
              requestHash: string;
              responseCode: number | null;
              responseBody: Record<string, unknown> | null;
            }
          | null = null;

        if (!claimed) {
          existingIdempotency = await this.idempotencyRepository.findByKey(
            idempotencyScope,
            tx,
          );

          if (!existingIdempotency) {
            throw new IdempotencyConflictError('Idempotency key collision.');
          }

          if (existingIdempotency.requestHash !== requestHash) {
            throw new IdempotencyConflictError(
              'Idempotency key reused with different payload.',
            );
          }
        }

        const reservation = await this.reservationRepository.findById(
          input.reservationId,
          tx,
        );

        if (!reservation) {
          throw new NotFoundError('Reservation not found.');
        }

        if (reservation.ownerUserId !== actorId) {
          throw new NotFoundError('Reservation not found.');
        }

        if (reservation.status !== ReservationStatus.HELD) {
          throw new InvalidStateTransitionError('Reservation is not active.');
        }

        if (reservation.expiresAt <= new Date()) {
          throw new InvalidStateTransitionError('Reservation has expired.');
        }

        await this.launchControl.assertCheckoutAllowed({
          eventId: reservation.eventId,
          currency: input.currency,
        });

        if (existingIdempotency) {
          if (!existingIdempotency.responseBody) {
            throw new IdempotencyConflictError(
              'Idempotent request is already in progress.',
            );
          }

          return existingIdempotency.responseBody as CreateOrderResult;
        }

        const orderId = randomUUID();

        await this.orderRepository.create(
          {
            id: orderId,
            userId: actorId,
            eventId: reservation.eventId,
            reservationId: reservation.id,
            totalAmount: input.totalAmount,
            currency: input.currency,
            status: OrderStatus.RESERVED,
          },
          tx,
        );

        const result: CreateOrderResult = {
          orderId,
          status: OrderStatus.RESERVED,
        };

        await this.idempotencyRepository.complete(
          {
            ...idempotencyScope,
            idempotencyKey: input.idempotencyKey,
            responseCode: 201,
            responseBody: result,
          },
          tx,
        );

        await this.auditLogRepository.append(
          {
            id: randomUUID(),
            actorId,
            action: 'ORDER_CREATED',
            entityType: 'order',
            entityId: orderId,
            correlationId,
            metadata: {
              reservationId: reservation.id,
              totalAmount: input.totalAmount.toString(),
              currency: input.currency,
            },
          },
          tx,
        );

        await this.outboxRepository.append(
          {
            id: randomUUID(),
            aggregateType: 'order',
            aggregateId: orderId,
            eventType: 'OrderCreated',
            payload: {
              orderId,
              reservationId: reservation.id,
              eventId: reservation.eventId,
            },
          },
          tx,
        );

        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );
  }
}
