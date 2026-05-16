import { PaymentStatus } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';

export interface PaymentRepository {
  create(
    input: {
      id: string;
      orderId: string;
      provider: string;
      providerRef?: string | null;
      status: PaymentStatus;
      amount: bigint;
    },
    tx: TxClient,
  ): Promise<void>;

  findByProviderRef(
    provider: string,
    providerRef: string,
    tx: TxClient,
  ): Promise<{
    id: string;
    orderId: string;
    status: PaymentStatus;
    amount: bigint;
  } | null>;

  findByOrderId(
    orderId: string,
    tx: TxClient,
  ): Promise<{
    id: string;
    orderId: string;
    provider: string;
    providerRef: string | null;
    status: PaymentStatus;
    amount: bigint;
  } | null>;

  updateStatus(paymentId: string, status: PaymentStatus, tx: TxClient): Promise<void>;
}
