import { randomUUID } from 'node:crypto';
import { RequestContextService } from '../../../src/shared/context/request-context.service';
import { PrismaAuditLogRepository } from '../../../src/modules/audit/infrastructure/repositories/prisma-audit-log.repository';
import {
  ReserveInventoryResult,
  ReserveInventoryUseCase,
} from '../../../src/modules/inventory/application/use-cases/reserve-inventory.use-case';
import { PrismaInventoryRepository } from '../../../src/modules/inventory/infrastructure/repositories/prisma-inventory.repository';
import { PrismaReservationRepository } from '../../../src/modules/inventory/infrastructure/repositories/prisma-reservation.repository';
import { PrismaOutboxRepository } from '../../../src/shared/outbox/prisma-outbox.repository';
import { TransactionRunnerService } from '../../../src/shared/prisma/transaction-runner.service';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from '../../setup/integration-runtime';
import { seedEventInventory } from '../../setup/seed-data';

describe('no oversell under concurrent reservation attempts', () => {
  let runtime: IntegrationRuntime | null = null;

  beforeAll(async () => {
    try {
      runtime = await createIntegrationRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  beforeEach(async () => {
    if (runtime) {
      await runtime.reset();
    }
  });

  it('never exceeds capacity and preserves reservation integrity', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedEventInventory(runtime.prisma);

    await runtime.prisma.eventTicketInventory.update({
      where: { id: seeded.inventoryId },
      data: {
        capacityTotal: 10,
      },
    });

    const requestContext = new RequestContextService();
    const useCase = new ReserveInventoryUseCase(
      new TransactionRunnerService(runtime.prisma),
      requestContext,
      new PrismaInventoryRepository(),
      new PrismaReservationRepository(),
      new PrismaAuditLogRepository(),
      new PrismaOutboxRepository(),
    );

    const attempts = Array.from({ length: 50 }).map(() =>
      requestContext.run(
        {
          requestId: randomUUID(),
          correlationId: randomUUID(),
          userId: seeded.userId,
        },
        () =>
          useCase.execute({
            eventId: seeded.eventId,
            ticketTypeId: seeded.ticketTypeId,
            quantity: 1,
            holdTtlSeconds: 300,
          }),
      ),
    );

    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<ReserveInventoryResult> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    const inventory = await runtime.prisma.eventTicketInventory.findUniqueOrThrow({
      where: { id: seeded.inventoryId },
    });
    const heldReservations = await runtime.prisma.ticketReservation.findMany({
      where: {
        eventId: seeded.eventId,
        ticketTypeId: seeded.ticketTypeId,
        status: 'HELD',
      },
    });
    const heldQuantity = heldReservations.reduce(
      (sum, reservation) => sum + reservation.quantity,
      0,
    );
    const uniqueReservationIds = new Set(
      heldReservations.map((reservation) => reservation.id),
    );

    expect(fulfilled.length).toBeLessThanOrEqual(10);
    expect(fulfilled.length).toBe(heldReservations.length);
    expect(inventory.reservedCount).toBe(heldQuantity);
    expect(inventory.reservedCount).toBeLessThanOrEqual(10);
    expect(uniqueReservationIds.size).toBe(heldReservations.length);

    for (const failure of rejected) {
      expect(failure.reason).toBeInstanceOf(Error);
      expect((failure.reason as Error).message).toMatch(
        /Not enough tickets available|serializ|concurrent update|conflict/i,
      );
    }
  });
});