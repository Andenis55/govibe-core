import { LedgerDirection } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';

export interface LedgerRepository {
  append(
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
  ): Promise<void>;
}
