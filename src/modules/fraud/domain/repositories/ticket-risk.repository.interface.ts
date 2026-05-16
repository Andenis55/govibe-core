import type { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class TicketRiskRepository {
  abstract save(
    flag: Record<string, unknown>,
    options?: RepositoryOptions,
  ): Promise<void>;
}
