import { Injectable } from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';
import { PaymentRepository } from '../../domain/repositories/payment.repository.interface';

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  async create(
    input: {
      id: string;
      orderId: string;
      provider: string;
      providerRef?: string | null;
      status: PaymentStatus;
      amount: bigint;
    },
    tx: TxClient,
  ): Promise<void> {
    await tx.payment.create({
      data: {
        id: input.id,
        orderId: input.orderId,
        provider: input.provider,
        providerRef: input.providerRef,
        status: input.status,
        amount: input.amount,
      },
    });
  }

  async findByProviderRef(
    provider: string,
    providerRef: string,
    tx: TxClient,
  ) {
    return tx.payment.findFirst({
      where: { provider, providerRef },
      select: {
        id: true,
        orderId: true,
        status: true,
        amount: true,
      },
    });
  }

  async findByOrderId(orderId: string, tx: TxClient) {
    return tx.payment.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        orderId: true,
        provider: true,
        providerRef: true,
        status: true,
        amount: true,
      },
    });
  }

  async updateStatus(
    paymentId: string,
    status: PaymentStatus,
    tx: TxClient,
  ): Promise<void> {
    await tx.payment.update({
      where: { id: paymentId },
      data: { status },
    });
  }
}