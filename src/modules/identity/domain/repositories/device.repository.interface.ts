import type { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class DeviceRepository {
  abstract findById(
    id: string,
    options?: RepositoryOptions,
  ): Promise<Record<string, unknown> | null>;
  abstract save(
    device: Record<string, unknown>,
    options?: RepositoryOptions,
  ): Promise<void>;
}
