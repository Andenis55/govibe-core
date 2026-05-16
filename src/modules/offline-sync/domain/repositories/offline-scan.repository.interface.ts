import type { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class OfflineScanRepository {
  abstract findById(
    id: string,
    options?: RepositoryOptions,
  ): Promise<Record<string, unknown> | null>;
  abstract save(
    scan: Record<string, unknown>,
    options?: RepositoryOptions,
  ): Promise<void>;
}
