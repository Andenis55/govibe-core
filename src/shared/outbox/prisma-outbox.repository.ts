import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TxClient } from '../prisma/prisma.types';
import { OutboxRepository } from './outbox.repository.interface';

@Injectable()
export class PrismaOutboxRepository implements OutboxRepository {
  async append(
    input: {
      id: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
    tx: TxClient,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        id: input.id,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        eventType: input.eventType,
        payload: input.payload as Prisma.InputJsonValue,
      },
    });
  }
}