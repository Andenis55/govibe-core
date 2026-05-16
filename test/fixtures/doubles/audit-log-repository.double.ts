import { AuditLogRepository } from '../../../src/modules/audit/domain/repositories/audit-log.repository.interface';
import { TxClient } from '../../../src/shared/prisma/prisma.types';

type AuditAppendInput = Parameters<AuditLogRepository['append']>[0];

export class AuditLogRepositoryDouble implements AuditLogRepository {
  public readonly entries: AuditAppendInput[] = [];

  async append(input: AuditAppendInput, _tx: TxClient): Promise<void> {
    this.entries.push(input);
  }
}