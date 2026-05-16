import { TxClient } from '../prisma/prisma.types';

export interface OutboxRepository {
  append(
    input: {
      id: string;
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Record<string, unknown>;
    },
    tx: TxClient,
  ): Promise<void>;
}