import {
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ReservationStatus } from '@prisma/client';
import { ReservationRepository } from '../../domain/repositories/reservation.repository.interface';
import { InventoryRepository } from '../../domain/repositories/inventory.repository.interface';
import { RESERVATION_REPOSITORY } from '../../inventory.tokens';
import { INVENTORY_REPOSITORY } from '../../inventory.tokens';
import { TransactionRunnerService } from '../../../../shared/prisma/transaction-runner.service';

export type ReleaseExpiredReservationInput = {
  reservationId: string;
  now?: Date;
};

export type ReleaseExpiredReservationResult = {
  released: boolean;
  inventoryId?: string;
  reservedCount?: number;
};

@Injectable()
export class ReleaseExpiredReservationUseCase {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    @Inject(INVENTORY_REPOSITORY)
    private readonly inventoryRepository: InventoryRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
  ) {}

  async execute(
    input: ReleaseExpiredReservationInput,
  ): Promise<ReleaseExpiredReservationResult> {
    const now = input.now ?? new Date();

    return this.transactionRunner.runInTransaction(async (tx) => {
      const reservation = await this.reservationRepository.findById(
        input.reservationId,
        tx,
      );

      if (!reservation) {
        throw new NotFoundException('Reservation not found');
      }

      if (
        reservation.status !== ReservationStatus.HELD ||
        reservation.expiresAt.getTime() > now.getTime()
      ) {
        return { released: false };
      }

      const inventory = await this.inventoryRepository.lockInventory(
        reservation.eventId,
        reservation.ticketTypeId,
        tx,
      );

      if (!inventory) {
        throw new NotFoundException('Inventory not found');
      }

      const liveReserved = await this.reservationRepository.getActiveReservationQuantity(
        reservation.eventId,
        reservation.ticketTypeId,
        tx,
      );

      await this.reservationRepository.updateReservationStatus(
        reservation.id,
        ReservationStatus.EXPIRED,
        tx,
      );
      await this.inventoryRepository.updateReservedCount(
        inventory.id,
        liveReserved,
        tx,
      );

      return {
        released: true,
        inventoryId: inventory.id,
        reservedCount: liveReserved,
      };
    });
  }
}
