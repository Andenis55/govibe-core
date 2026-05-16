import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  InventoryRepository,
} from '../../domain/repositories/inventory.repository.interface';
import { LockedInventoryRecord } from '../../domain/types/inventory.types';
import { TxClient } from '../../../../shared/prisma/prisma.types';

@Injectable()
export class PrismaInventoryRepository implements InventoryRepository {
  async lockInventory(
    eventId: string,
    ticketTypeId: string,
    tx: TxClient,
  ): Promise<LockedInventoryRecord | null> {
    const rows = await tx.$queryRaw<LockedInventoryRecord[]>(Prisma.sql`
      SELECT
        id,
        event_id AS "eventId",
        ticket_type_id AS "ticketTypeId",
        capacity_total AS "capacityTotal",
        reserved_count AS "reservedCount",
        sold_count AS "soldCount"
      FROM event_ticket_inventory
      WHERE event_id = ${eventId}::uuid
        AND ticket_type_id = ${ticketTypeId}::uuid
      FOR UPDATE
    `);

    return rows[0] ?? null;
  }

  async updateReservedCount(
    inventoryId: string,
    newReservedCount: number,
    tx: TxClient,
  ): Promise<void> {
    await tx.eventTicketInventory.update({
      where: { id: inventoryId },
      data: { reservedCount: newReservedCount },
    });
  }

  async incrementSoldCount(
    inventoryId: string,
    delta: number,
    tx: TxClient,
  ): Promise<void> {
    await tx.eventTicketInventory.update({
      where: { id: inventoryId },
      data: {
        soldCount: { increment: delta },
      },
    });
  }
}
