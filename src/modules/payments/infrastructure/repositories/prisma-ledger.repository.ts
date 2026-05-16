import { Injectable } from '@nestjs/common';
import { LedgerDirection } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';
import { LedgerRepository } from '../../domain/repositories/ledger.repository.interface';

@Injectable()
export class PrismaLedgerRepository implements LedgerRepository {
  async append(
    input: {
      id: string;
      orderId?: string | null;
      paymentId?: string | null;
      direction: LedgerDirection;
      accountType: string;
      amount: bigint;
      currency: string;
      correlationId?: string | null;
    },
    tx: TxClient,
  ): Promise<void> {
    await tx.ledgerEntry.create({
      data: {
        id: input.id,
        orderId: input.orderId,
        paymentId: input.paymentId,
        direction: input.direction,
        accountType: input.accountType,
        amount: input.amount,
        currency: input.currency,
        correlationId: input.correlationId,
      },
    });
  }
}