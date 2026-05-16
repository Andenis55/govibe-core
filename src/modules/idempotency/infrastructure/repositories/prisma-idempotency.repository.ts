import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';
import { IdempotencyRepository } from '../../domain/repositories/idempotency.repository.interface';

@Injectable()
export class PrismaIdempotencyRepository implements IdempotencyRepository {
  async findByKey(
    input: {
      actorUserId: string;
      useCase: string;
      idempotencyKey: string;
    },
    tx: TxClient,
  ) {
    const idempotencyKeyHash = this.hashIdempotencyKey(input.idempotencyKey);
    const record = await tx.idempotencyKey.findUnique({
      where: {
        actorUserId_useCase_idempotencyKeyHash: {
          actorUserId: input.actorUserId,
          useCase: input.useCase,
          idempotencyKeyHash,
        },
      },
      select: {
        actorUserId: true,
        useCase: true,
        idempotencyKeyHash: true,
        requestHash: true,
        responseCode: true,
        responseBody: true,
      },
    });

    if (!record) {
      return null;
    }

    return {
      ...record,
      responseBody:
        record.responseBody && typeof record.responseBody === 'object'
          ? (record.responseBody as Record<string, unknown>)
          : null,
    };
  }

  async tryCreatePending(
    input: {
      actorUserId: string;
      useCase: string;
      idempotencyKey: string;
      requestHash: string;
    },
    tx: TxClient,
  ): Promise<boolean> {
    try {
      await tx.idempotencyKey.create({
        data: {
          actorUserId: input.actorUserId,
          useCase: input.useCase,
          idempotencyKeyHash: this.hashIdempotencyKey(input.idempotencyKey),
          requestHash: input.requestHash,
        },
      });

      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }

      throw error;
    }
  }

  async complete(
    input: {
      actorUserId: string;
      useCase: string;
      idempotencyKey: string;
      responseCode: number;
      responseBody: Record<string, unknown>;
    },
    tx: TxClient,
  ): Promise<void> {
    await tx.idempotencyKey.update({
      where: {
        actorUserId_useCase_idempotencyKeyHash: {
          actorUserId: input.actorUserId,
          useCase: input.useCase,
          idempotencyKeyHash: this.hashIdempotencyKey(input.idempotencyKey),
        },
      },
      data: {
        responseCode: input.responseCode,
        responseBody: input.responseBody as Prisma.InputJsonValue,
      },
    });
  }

  private hashIdempotencyKey(idempotencyKey: string): string {
    return createHash('sha256').update(idempotencyKey).digest('hex');
  }
}