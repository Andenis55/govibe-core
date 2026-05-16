import { OrderStatus } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';

export type CreateOrderInput = {
  id: string;
  userId: string;
  eventId: string;
  reservationId: string;
  totalAmount: bigint;
  currency: string;
  status: OrderStatus;
};

export interface OrderRepository {
  create(input: CreateOrderInput, tx: TxClient): Promise<void>;
  findById(
    orderId: string,
    tx: TxClient,
  ): Promise<{
    id: string;
    userId: string;
    eventId: string;
    reservationId: string | null;
    status: OrderStatus;
    totalAmount: bigint;
    currency: string;
  } | null>;
  updateStatus(orderId: string, status: OrderStatus, tx: TxClient): Promise<void>;
}
