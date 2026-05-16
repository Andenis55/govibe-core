import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';
import {
  CreateOrderInput,
  OrderRepository,
} from '../../domain/repositories/order.repository.interface';

@Injectable()
export class PrismaOrderRepository implements OrderRepository {
  async create(input: CreateOrderInput, tx: TxClient): Promise<void> {
    await tx.order.create({
      data: {
        id: input.id,
        userId: input.userId,
        eventId: input.eventId,
        reservationId: input.reservationId,
        totalAmount: input.totalAmount,
        currency: input.currency,
        status: input.status,
      },
    });
  }

  async findById(orderId: string, tx: TxClient) {
    return tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        userId: true,
        eventId: true,
        reservationId: true,
        status: true,
        totalAmount: true,
        currency: true,
      },
    });
  }

  async updateStatus(
    orderId: string,
    status: OrderStatus,
    tx: TxClient,
  ): Promise<void> {
    await tx.order.update({
      where: { id: orderId },
      data: { status },
    });
  }
}