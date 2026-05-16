import type { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class SuspiciousEventRepository {
  abstract append(
    event: Record<string, unknown>,
    options?: RepositoryOptions,
  ): Promise<void>;
}
