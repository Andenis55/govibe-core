import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryRepository } from '../../domain/repositories/inventory.repository.interface';
import { ReservationRepository } from '../../domain/repositories/reservation.repository.interface';
import {
  INVENTORY_REPOSITORY,
  RESERVATION_REPOSITORY,
} from '../../inventory.tokens';
import { TransactionRunnerService } from '../../../../shared/prisma/transaction-runner.service';

export type ReconcileInventoryDriftInput = {
  eventId: string;
  ticketTypeId: string;
};

export type ReconcileInventoryDriftResult = {
  inventoryId: string;
  cachedReservedCount: number;
  liveReservedCount: number;
  corrected: boolean;
};

@Injectable()
export class ReconcileInventoryDriftUseCase {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
  ) {}

  async execute(
    input: ReconcileInventoryDriftInput,
  ): Promise<ReconcileInventoryDriftResult> {
    return this.transactionRunner.runInTransaction(async (tx) => {
      const inventory = await this.inventoryRepository.lockInventory(
        input.eventId,
        input.ticketTypeId,
        tx,
      );

      if (!inventory) {
        throw new NotFoundException('Inventory not found');
      }

      const liveReserved = await this.reservationRepository.getActiveReservationQuantity(
        input.eventId,
        input.ticketTypeId,
        tx,
      );
      const corrected = liveReserved !== inventory.reservedCount;

      if (corrected) {
        await this.inventoryRepository.updateReservedCount(
          inventory.id,
          liveReserved,
          tx,
        );
      }

      return {
        inventoryId: inventory.id,
        cachedReservedCount: inventory.reservedCount,
        liveReservedCount: liveReserved,
        corrected,
      };
    });
  }
}
