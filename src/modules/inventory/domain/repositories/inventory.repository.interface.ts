import { TxClient } from '../../../../shared/prisma/prisma.types';
import { LockedInventoryRecord } from '../types/inventory.types';

export interface InventoryRepository {
  lockInventory(
    eventId: string,
    ticketTypeId: string,
    tx: TxClient,
  ): Promise<LockedInventoryRecord | null>;

  updateReservedCount(
    inventoryId: string,
    newReservedCount: number,
    tx: TxClient,
  ): Promise<void>;

  incrementSoldCount(
    inventoryId: string,
    delta: number,
    tx: TxClient,
  ): Promise<void>;
}
