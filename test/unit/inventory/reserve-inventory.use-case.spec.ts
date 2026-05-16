import { ReserveInventoryUseCase } from '../../../src/modules/inventory/application/use-cases/reserve-inventory.use-case';
import { InventoryRepository } from '../../../src/modules/inventory/domain/repositories/inventory.repository.interface';
import { ReservationRepository } from '../../../src/modules/inventory/domain/repositories/reservation.repository.interface';
import { InventoryBuilder } from '../../fixtures/builders/inventory.builder';
import { AuditLogRepositoryDouble } from '../../fixtures/doubles/audit-log-repository.double';
import { OutboxRepositoryDouble } from '../../fixtures/doubles/outbox-repository.double';
import { RequestContextDouble } from '../../fixtures/doubles/request-context.double';
import { TransactionRunnerDouble } from '../../fixtures/doubles/transaction-runner.double';

describe('ReserveInventoryUseCase', () => {
  let transactionRunner: TransactionRunnerDouble;
  let requestContext: RequestContextDouble;
  let inventoryRepository: jest.Mocked<InventoryRepository>;
  let reservationRepository: jest.Mocked<ReservationRepository>;
  let auditLogRepository: AuditLogRepositoryDouble;
  let outboxRepository: OutboxRepositoryDouble;
  let useCase: ReserveInventoryUseCase;

  beforeEach(() => {
    transactionRunner = new TransactionRunnerDouble();
    requestContext = new RequestContextDouble({
      userId: 'user-1',
      correlationId: 'corr-1',
    });
    inventoryRepository = {
      lockInventory: jest.fn(),
      updateReservedCount: jest.fn(),
      incrementSoldCount: jest.fn(),
    };
    reservationRepository = {
      createHeldReservation: jest.fn(),
      claimExpiredHeldReservations: jest.fn(),
      getActiveReservationQuantity: jest.fn(),
      updateReservationStatus: jest.fn(),
      findById: jest.fn(),
    };
    auditLogRepository = new AuditLogRepositoryDouble();
    outboxRepository = new OutboxRepositoryDouble();

    useCase = new ReserveInventoryUseCase(
      transactionRunner.asService(),
      requestContext.asService(),
      inventoryRepository,
      reservationRepository,
      auditLogRepository,
      outboxRepository,
    );
  });

  it('creates held reservation and updates reserved count', async () => {
    const inventory = new InventoryBuilder()
      .with('capacityTotal', 100)
      .with('reservedCount', 10)
      .with('soldCount', 20)
      .build();

    inventoryRepository.lockInventory.mockResolvedValue(inventory);
    reservationRepository.getActiveReservationQuantity.mockResolvedValue(10);

    const result = await useCase.execute({
      eventId: inventory.eventId,
      ticketTypeId: inventory.ticketTypeId,
      quantity: 5,
      holdTtlSeconds: 300,
    });

    expect(result.quantity).toBe(5);
    expect(reservationRepository.createHeldReservation).toHaveBeenCalledTimes(1);
    expect(reservationRepository.createHeldReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'user-1',
      }),
      transactionRunner.client,
    );
    expect(inventoryRepository.updateReservedCount).toHaveBeenCalledWith(
      inventory.id,
      15,
      transactionRunner.client,
    );
    expect(auditLogRepository.entries).toHaveLength(1);
    expect(outboxRepository.events).toHaveLength(1);
  });

  it('uses authoritative active reservation quantity when inventory is tight', async () => {
    const inventory = new InventoryBuilder()
      .with('capacityTotal', 100)
      .with('reservedCount', 45)
      .with('soldCount', 10)
      .build();

    inventoryRepository.lockInventory.mockResolvedValue(inventory);
    reservationRepository.getActiveReservationQuantity.mockResolvedValue(40);

    await useCase.execute({
      eventId: inventory.eventId,
      ticketTypeId: inventory.ticketTypeId,
      quantity: 5,
      holdTtlSeconds: 300,
    });

    expect(reservationRepository.getActiveReservationQuantity).toHaveBeenCalledTimes(1);
    expect(inventoryRepository.updateReservedCount).toHaveBeenCalledWith(
      inventory.id,
      45,
      transactionRunner.client,
    );
  });

  it('rejects when requested quantity exceeds availability', async () => {
    const inventory = new InventoryBuilder()
      .with('capacityTotal', 10)
      .with('reservedCount', 5)
      .with('soldCount', 5)
      .build();

    inventoryRepository.lockInventory.mockResolvedValue(inventory);
    reservationRepository.getActiveReservationQuantity.mockResolvedValue(5);

    await expect(
      useCase.execute({
        eventId: inventory.eventId,
        ticketTypeId: inventory.ticketTypeId,
        quantity: 1,
        holdTtlSeconds: 300,
      }),
    ).rejects.toThrow('Not enough tickets available.');
  });
});