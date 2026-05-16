import { Prisma, PrismaClient } from '@prisma/client';

export type DbClient = PrismaClient | Prisma.TransactionClient;
export type TxClient = Prisma.TransactionClient;

export interface RepositoryOptions {
  readonly tx?: TxClient;
}

export function resolveDbClient(
  prisma: PrismaClient,
  options?: RepositoryOptions,
): DbClient {
  return options?.tx ?? prisma;
}