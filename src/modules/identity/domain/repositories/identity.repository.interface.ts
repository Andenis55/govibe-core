import type { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class IdentityRepository {
  abstract findById(
    id: string,
    options?: RepositoryOptions,
  ): Promise<Record<string, unknown> | null>;
  abstract save(
    identity: Record<string, unknown>,
    options?: RepositoryOptions,
  ): Promise<void>;
}
