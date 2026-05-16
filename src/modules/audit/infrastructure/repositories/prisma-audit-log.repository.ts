import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';
import { AuditLogRepository } from '../../domain/repositories/audit-log.repository.interface';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogRepository {
  async append(
    input: {
      id: string;
      actorId?: string | null;
      action: string;
      entityType: string;
      entityId: string;
      correlationId?: string | null;
      metadata: Record<string, unknown>;
    },
    tx: TxClient,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: input.id,
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        correlationId: input.correlationId,
        metadata: input.metadata as Prisma.InputJsonValue,
      },
    });
  }
}