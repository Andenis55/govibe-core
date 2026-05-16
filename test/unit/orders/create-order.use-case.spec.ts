import { createHash } from 'node:crypto';
import { OrderStatus, Prisma, ReservationStatus } from '@prisma/client';
import { RequestContextService } from '../../../src/shared/context/request-context.service';
import { TransactionRunnerService } from '../../../src/shared/prisma/transaction-runner.service';
import { CreateOrderUseCase } from '../../../src/modules/orders/application/use-cases/create-order.use-case';
import { LaunchControlDouble } from '../../fixtures/doubles/launch-control.double';
import { ReservationBuilder } from '../../fixtures/builders/reservation.builder';

describe('CreateOrderUseCase', () => {
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
    create: jest.fn(),
  };
  const reservationRepository = {
    findById: jest.fn(),
  };
  const idempotencyRepository = {
    tryCreatePending: jest.fn(),
    findByKey: jest.fn(),
    complete: jest.fn(),
  };
  const auditLogRepository = {
    append: jest.fn(),
  };
  const outboxRepository = {
    append: jest.fn(),
  };
  const launchControl = new LaunchControlDouble();

  let useCase: CreateOrderUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    requestContext.get = jest.fn().mockReturnValue({
      userId: 'user-1',
      correlationId: 'corr-1',
    });

    useCase = new CreateOrderUseCase(
      transactionRunner,
      requestContext,
      launchControl.asService(),
      orderRepository as never,
      reservationRepository as never,
      idempotencyRepository as never,
      auditLogRepository as never,
      outboxRepository as never,
    );
  });

  it('creates an order and persists the idempotent result', async () => {
    const reservation = new ReservationBuilder().build();

    reservationRepository.findById.mockResolvedValue(reservation);
    idempotencyRepository.tryCreatePending.mockResolvedValue(true);

    const result = await useCase.execute({
      idempotencyKey: 'idem-key-12345',
      reservationId: reservation.id,
      totalAmount: BigInt(12000),
      currency: 'GHS',
    });

    expect(result.status).toBe(OrderStatus.RESERVED);
    expect(result.orderId).toBeDefined();
    expect(orderRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        reservationId: reservation.id,
        totalAmount: BigInt(12000),
        currency: 'GHS',
        status: OrderStatus.RESERVED,
      }),
      tx,
    );
    expect(launchControl.assertCheckoutAllowed).toHaveBeenCalledWith({
      eventId: reservation.eventId,
      currency: 'GHS',
    });
    expect(idempotencyRepository.tryCreatePending).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        useCase: 'checkout.create_order',
        idempotencyKey: 'idem-key-12345',
      }),
      tx,
    );
    expect(idempotencyRepository.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'user-1',
        useCase: 'checkout.create_order',
        idempotencyKey: 'idem-key-12345',
        responseCode: 201,
        responseBody: expect.objectContaining({
          orderId: result.orderId,
          status: OrderStatus.RESERVED,
        }),
      }),
      tx,
    );
  });

  it('replays the same response for the same idempotency key and payload hash', async () => {
    const input = {
      idempotencyKey: 'idem-key-12345',
      reservationId: 'res-1',
      totalAmount: BigInt(12000),
      currency: 'GHS',
    };

    idempotencyRepository.tryCreatePending.mockResolvedValue(false);
    idempotencyRepository.findByKey.mockResolvedValue({
      actorUserId: 'user-1',
      useCase: 'checkout.create_order',
      idempotencyKeyHash: 'hash-1',
      requestHash: createOrderHash(input),
      responseCode: 201,
      responseBody: {
        orderId: 'order-1',
        status: OrderStatus.RESERVED,
      },
    });

    const result = await useCase.execute(input);

    expect(result).toEqual({
      orderId: 'order-1',
      status: OrderStatus.RESERVED,
    });
    expect(idempotencyRepository.findByKey).toHaveBeenCalledWith(
      {
        actorUserId: 'user-1',
        useCase: 'checkout.create_order',
        idempotencyKey: input.idempotencyKey,
      },
      tx,
    );
    expect(orderRepository.create).not.toHaveBeenCalled();
    expect(idempotencyRepository.complete).not.toHaveBeenCalled();
  });

  it('rejects checkout when the reservation belongs to another user', async () => {
    const reservation = new ReservationBuilder()
      .with('ownerUserId', 'user-2')
      .build();

    reservationRepository.findById.mockResolvedValue(reservation);
    idempotencyRepository.tryCreatePending.mockResolvedValue(true);

    await expect(
      useCase.execute({
        idempotencyKey: 'idem-key-other-user',
        reservationId: reservation.id,
        totalAmount: BigInt(5000),
        currency: 'GHS',
      }),
    ).rejects.toThrow('Reservation not found.');

    expect(orderRepository.create).not.toHaveBeenCalled();
    expect(idempotencyRepository.complete).not.toHaveBeenCalled();
  });

  it('does not replay a cached response before reservation ownership is valid', async () => {
    const reservation = new ReservationBuilder()
      .with('ownerUserId', 'user-2')
      .build();
    const input = {
      idempotencyKey: 'idem-key-ownership',
      reservationId: reservation.id,
      totalAmount: BigInt(12000),
      currency: 'GHS',
    };

    idempotencyRepository.tryCreatePending.mockResolvedValue(false);
    idempotencyRepository.findByKey.mockResolvedValue({
      actorUserId: 'user-1',
      useCase: 'checkout.create_order',
      idempotencyKeyHash: 'hash-2',
      requestHash: createOrderHash(input),
      responseCode: 201,
      responseBody: {
        orderId: 'order-1',
        status: OrderStatus.RESERVED,
      },
    });
    reservationRepository.findById.mockResolvedValue(reservation);

    await expect(useCase.execute(input)).rejects.toThrow('Reservation not found.');

    expect(orderRepository.create).not.toHaveBeenCalled();
  });

  it('rejects an expired reservation', async () => {
    const expiredReservation = new ReservationBuilder()
      .with('expiresAt', new Date(Date.now() - 1000))
      .with('status', ReservationStatus.HELD)
      .build();

    reservationRepository.findById.mockResolvedValue(expiredReservation);
    idempotencyRepository.tryCreatePending.mockResolvedValue(true);

    await expect(
      useCase.execute({
        idempotencyKey: 'idem-key-expired',
        reservationId: expiredReservation.id,
        totalAmount: BigInt(5000),
        currency: 'GHS',
      }),
    ).rejects.toThrow('Reservation has expired.');
  });
});

function createOrderHash(input: {
  idempotencyKey: string;
  reservationId: string;
  totalAmount: bigint;
  currency: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify(input, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    )
    .digest('hex');
}