import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  RepositoryOptions,
  resolveDbClient,
} from '../../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import { PaymentIntentAuditLogRepository } from '../../domain/repositories/payment-intent-audit-log.repository.interface';

@Injectable()
export class PrismaPaymentIntentAuditLogRepository
  implements PaymentIntentAuditLogRepository
{
  constructor(private readonly prisma: PrismaService) {}

  async append(
    input: {
      paymentIntentId: string;
      buyerUserId: string;
      eventType: string;
      data: Prisma.InputJsonValue;
    },
    options?: RepositoryOptions,
  ): Promise<void> {
    const db = resolveDbClient(this.prisma, options);

    await db.paymentIntentAuditLog.create({
      data: {
        paymentIntentId: input.paymentIntentId,
        buyerUserId: input.buyerUserId,
        eventType: input.eventType,
        data: input.data,
      },
    });
  }
}