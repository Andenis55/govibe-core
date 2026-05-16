import {
  OrderStatus,
  Prisma,
  ReservationStatus,
  TicketStatus,
} from '@prisma/client';
import { RequestContextService } from '../../../src/shared/context/request-context.service';
import { TransactionRunnerService } from '../../../src/shared/prisma/transaction-runner.service';
import { IssueTicketsUseCase } from '../../../src/modules/tickets/application/use-cases/issue-tickets.use-case';
import { InventoryBuilder } from '../../fixtures/builders/inventory.builder';
import { OrderBuilder } from '../../fixtures/builders/order.builder';
import { ReservationBuilder } from '../../fixtures/builders/reservation.builder';

describe('IssueTicketsUseCase', () => {
  const tx = {} as Prisma.TransactionClient;

  const transactionRunner = {
    runInTransaction: jest.fn(
      async <T>(callback: (client: Prisma.TransactionClient) => Promise<T>) =>
        callback(tx),
    ),
  } as unknown as TransactionRunnerService;
  const requestContext = {
    get: jest.fn(),
  } as unknown as RequestContextService;
  const orderRepository = {
    findById: jest.fn(),
    updateStatus: jest.fn(),
  };
  const inventoryRepository = {
    lockInventory: jest.fn(),
    updateReservedCount: jest.fn(),
    incrementSoldCount: jest.fn(),
  };
  const reservationRepository = {
    findById: jest.fn(),
    updateReservationStatus: jest.fn(),
    getActiveReservationQuantity: jest.fn(),
  };
  const ticketRepository = {
    create: jest.fn(),
  };
  const ticketReferenceAllocator = {
    allocateBatch: jest.fn(),
  };
  const auditLogRepository = {
    append: jest.fn(),
  };
  const outboxRepository = {
    append: jest.fn(),
  };

  let useCase: IssueTicketsUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    requestContext.get = jest.fn().mockReturnValue({
      userId: 'user-1',
      correlationId: 'corr-1',
    });

    useCase = new IssueTicketsUseCase(
      transactionRunner,
      requestContext,
      orderRepository as never,
      inventoryRepository as never,
      reservationRepository as never,
      ticketRepository as never,
      ticketReferenceAllocator as never,
      auditLogRepository as never,
      outboxRepository as never,
    );
  });

  it('creates tickets, consumes the reservation, updates inventory, and fulfills the order', async () => {
    const order = new OrderBuilder()
      .with('id', 'order-1')
      .with('userId', 'user-1')
      .with('eventId', 'event-1')
      .with('reservationId', 'res-1')
      .with('status', OrderStatus.PAID)
      .build();
    const reservation = new ReservationBuilder()
      .with('id', 'res-1')
      .with('eventId', 'event-1')
      .with('ticketTypeId', 'type-1')
      .with('quantity', 2)
      .with('status', ReservationStatus.HELD)
      .build();
    const inventory = new InventoryBuilder()
      .with('id', 'inv-1')
      .with('eventId', 'event-1')
      .with('ticketTypeId', 'type-1')
      .with('reservedCount', 2)
      .with('soldCount', 10)
      .build();

    orderRepository.findById.mockResolvedValue(order);
    reservationRepository.findById.mockResolvedValue(reservation);
    inventoryRepository.lockInventory.mockResolvedValue(inventory);
    reservationRepository.getActiveReservationQuantity.mockResolvedValue(0);
    ticketReferenceAllocator.allocateBatch.mockImplementation(
      async (
        count: number,
        writer: (
          refs: Array<{ ticketSerial: string; publicReference: string }>,
        ) => Promise<unknown>,
      ) =>
        writer([
          { ticketSerial: 'GVS-AAA', publicReference: 'GV-111' },
          { ticketSerial: 'GVS-BBB', publicReference: 'GV-222' },
        ].slice(0, count)),
    );

    const result = await useCase.execute({ orderId: 'order-1' });

    expect(result.issuedTicketIds).toHaveLength(2);
    expect(ticketRepository.create).toHaveBeenCalledTimes(2);
    expect(reservationRepository.updateReservationStatus).toHaveBeenCalledWith(
      'res-1',
      ReservationStatus.CONSUMED,
      tx,
    );
    expect(inventoryRepository.updateReservedCount).toHaveBeenCalledWith(
      'inv-1',
      0,
      tx,
    );
    expect(inventoryRepository.incrementSoldCount).toHaveBeenCalledWith(
      'inv-1',
      2,
      tx,
    );
    expect(orderRepository.updateStatus).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.FULFILLED,
      tx,
    );
    expect(auditLogRepository.append).toHaveBeenCalled();
    expect(outboxRepository.append).toHaveBeenCalled();
  });

  it('rejects if the order is not PAID', async () => {
    const unpaidOrder = new OrderBuilder().with('status', OrderStatus.RESERVED).build();

    orderRepository.findById.mockResolvedValue(unpaidOrder);

    await expect(useCase.execute({ orderId: unpaidOrder.id })).rejects.toThrow(
      'Only paid orders can issue tickets.',
    );
    expect(ticketReferenceAllocator.allocateBatch).not.toHaveBeenCalled();
  });
});