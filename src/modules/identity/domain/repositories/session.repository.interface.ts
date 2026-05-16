import type { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class SessionRepository {
  abstract findById(
    id: string,
    options?: RepositoryOptions,
  ): Promise<Record<string, unknown> | null>;
  abstract save(
    session: Record<string, unknown>,
    options?: RepositoryOptions,
  ): Promise<void>;
}
