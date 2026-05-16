import { TxClient } from '../../../../shared/prisma/prisma.types';

export interface AuditLogRepository {
  append(
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
  ): Promise<void>;
}
