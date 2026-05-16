import { TxClient } from '../../../../shared/prisma/prisma.types';

export interface IdempotencyRepository {
  findByKey(
    input: {
      actorUserId: string;
      useCase: string;
      idempotencyKey: string;
    },
    tx: TxClient,
  ): Promise<{
    actorUserId: string;
    useCase: string;
    idempotencyKeyHash: string;
    requestHash: string;
    responseCode: number | null;
    responseBody: Record<string, unknown> | null;
  } | null>;

  tryCreatePending(
    input: {
      actorUserId: string;
      useCase: string;
      idempotencyKey: string;
      requestHash: string;
    },
    tx: TxClient,
  ): Promise<boolean>;

  complete(
    input: {
      actorUserId: string;
      useCase: string;
      idempotencyKey: string;
      responseCode: number;
      responseBody: Record<string, unknown>;
    },
    tx: TxClient,
  ): Promise<void>;
}