import type { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class DeviceRiskRepository {
  abstract save(
    flag: Record<string, unknown>,
    options?: RepositoryOptions,
  ): Promise<void>;
}
