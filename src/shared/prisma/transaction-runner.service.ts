import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { TxClient } from './prisma.types';

@Injectable()
export class TransactionRunnerService {
  constructor(private readonly prisma: PrismaService) {}

  async runInTransaction<T>(
    fn: (tx: TxClient) => Promise<T>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      maxWait?: number;
      timeout?: number;
    },
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx: TxClient) => fn(tx),
      {
        isolationLevel:
          options?.isolationLevel ??
          Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: options?.maxWait ?? 5000,
        timeout: options?.timeout ?? 10000,
      },
    );
  }
}