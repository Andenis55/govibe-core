import { Prisma } from '@prisma/client';
import { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class PaymentIntentAuditLogRepository {
  abstract append(
    input: {
      paymentIntentId: string;
      buyerUserId: string;
      eventType: string;
      data: Prisma.InputJsonValue;
    },
    options?: RepositoryOptions,
  ): Promise<void>;
}