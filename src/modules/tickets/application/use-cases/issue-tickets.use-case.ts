import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  OrderStatus,
  Prisma,
  ReservationStatus,
  TicketStatus,
} from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '../../../audit/audit.tokens';
import { AuditLogRepository } from '../../../audit/domain/repositories/audit-log.repository.interface';
import {
  INVENTORY_REPOSITORY,
  RESERVATION_REPOSITORY,
} from '../../../inventory/inventory.tokens';
import { InventoryRepository } from '../../../inventory/domain/repositories/inventory.repository.interface';
import { ReservationRepository } from '../../../inventory/domain/repositories/reservation.repository.interface';
import { ORDER_REPOSITORY } from '../../../orders/orders.tokens';
import { OrderRepository } from '../../../orders/domain/repositories/order.repository.interface';
import { TICKET_REPOSITORY } from '../../tickets.tokens';
import {
  CreateTicketInput,
  TicketRepository,
} from '../../domain/repositories/ticket.repository.interface';
import { RequestContextService } from '../../../../shared/context/request-context.service';
import {
  InvalidStateTransitionError,
  NotFoundError,
} from '../../../../shared/errors/domain-errors';
import { OutboxRepository } from '../../../../shared/outbox/outbox.repository.interface';
import { OUTBOX_REPOSITORY } from '../../../../shared/outbox/outbox.tokens';
import { TransactionRunnerService } from '../../../../shared/prisma/transaction-runner.service';
import { DefaultTicketReferenceAllocatorService } from '../../../../shared/tickets/ticket-reference-allocator.service';

export type IssueTicketsInput = {
  orderId: string;
};

export type IssueTicketsResult = {
  orderId: string;
  issuedTicketIds: string[];
};

@Injectable()
export class IssueTicketsUseCase {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly requestContext: RequestContextService,
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    @Inject(TICKET_REPOSITORY)
    private readonly ticketRepository: TicketRepository,
    private readonly ticketReferenceAllocator: DefaultTicketReferenceAllocatorService,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: AuditLogRepository,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(input: IssueTicketsInput): Promise<IssueTicketsResult> {
    const reservationQuantity = await this.getReservationQuantity(input.orderId);

    return this.ticketReferenceAllocator.allocateBatch(
      reservationQuantity,
      (refs) => this.issueWithReferences(input.orderId, refs),
    );
  }

  private async getReservationQuantity(orderId: string): Promise<number> {
    return this.transactionRunner.runInTransaction(
      async (tx) => {
        const { reservation } = await this.loadValidatedOrderReservation(tx, orderId);
        return reservation.quantity;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 8000,
      },
    );
  }

  private async issueWithReferences(
    orderId: string,
    refs: Array<{ ticketSerial: string; publicReference: string }>,
  ): Promise<IssueTicketsResult> {
    const ctx = this.requestContext.get();

    return this.transactionRunner.runInTransaction(
      async (tx) => {
        const { order, reservation } = await this.loadValidatedOrderReservation(
          tx,
          orderId,
        );

        if (reservation.quantity !== refs.length) {
          throw new InvalidStateTransitionError(
            'Allocated ticket reference batch does not match reservation quantity.',
          );
        }

        const inventory = await this.inventoryRepository.lockInventory(
          reservation.eventId,
          reservation.ticketTypeId,
          tx,
        );

        if (!inventory) {
          throw new NotFoundError('Inventory bucket not found.');
        }

        const ticketInputs: CreateTicketInput[] = refs.map((ref) => ({
          id: randomUUID(),
          eventId: order.eventId,
          ticketTypeId: reservation.ticketTypeId,
          ownerUserId: order.userId,
          orderId: order.id,
          status: TicketStatus.ACTIVE,
          ticketSerial: ref.ticketSerial,
          publicReference: ref.publicReference,
        }));
        const issuedTicketIds = ticketInputs.map((ticket) => ticket.id);

        for (const ticketInput of ticketInputs) {
          await this.ticketRepository.create(ticketInput, tx);
        }

        await this.reservationRepository.updateReservationStatus(
          reservation.id,
          ReservationStatus.CONSUMED,
          tx,
        );

        const remainingReserved =
          await this.reservationRepository.getActiveReservationQuantity(
            reservation.eventId,
            reservation.ticketTypeId,
            tx,
          );

        await this.inventoryRepository.updateReservedCount(
          inventory.id,
          remainingReserved,
          tx,
        );

        await this.inventoryRepository.incrementSoldCount(
          inventory.id,
          reservation.quantity,
          tx,
        );

        await this.orderRepository.updateStatus(order.id, OrderStatus.FULFILLED, tx);

        await this.auditLogRepository.append(
          {
            id: randomUUID(),
            actorId: ctx?.userId ?? null,
            action: 'TICKETS_ISSUED',
            entityType: 'order',
            entityId: order.id,
            correlationId: ctx?.correlationId,
            metadata: {
              reservationId: reservation.id,
              quantity: reservation.quantity,
              ticketIds: issuedTicketIds,
            },
          },
          tx,
        );

        await this.outboxRepository.append(
          {
            id: randomUUID(),
            aggregateType: 'order',
            aggregateId: order.id,
            eventType: 'TicketsIssued',
            payload: {
              orderId: order.id,
              ticketIds: issuedTicketIds,
              quantity: reservation.quantity,
            },
          },
          tx,
        );

        return {
          orderId: order.id,
          issuedTicketIds,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 20000,
      },
    );
  }

  private async loadValidatedOrderReservation(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<{
    order: {
      id: string;
      userId: string;
      eventId: string;
      reservationId: string | null;
      status: OrderStatus;
    };
    reservation: {
      id: string;
      eventId: string;
      ticketTypeId: string;
      quantity: number;
      status: ReservationStatus;
    };
  }> {
    const order = await this.orderRepository.findById(orderId, tx);

    if (!order) {
      throw new NotFoundError('Order not found.');
    }

    if (order.status !== OrderStatus.PAID) {
      throw new InvalidStateTransitionError(
        'Only paid orders can issue tickets.',
      );
    }

    if (!order.reservationId) {
      throw new InvalidStateTransitionError('Order has no linked reservation.');
    }

    const reservation = await this.reservationRepository.findById(
      order.reservationId,
      tx,
    );

    if (!reservation) {
      throw new NotFoundError('Reservation not found.');
    }

    if (reservation.status !== ReservationStatus.HELD) {
      throw new InvalidStateTransitionError('Reservation is not consumable.');
    }

    return {
      order: {
        id: order.id,
        userId: order.userId,
        eventId: order.eventId,
        reservationId: order.reservationId,
        status: order.status,
      },
      reservation: {
        id: reservation.id,
        eventId: reservation.eventId,
        ticketTypeId: reservation.ticketTypeId,
        quantity: reservation.quantity,
        status: reservation.status,
      },
    };
  }
}
