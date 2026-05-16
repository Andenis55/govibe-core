import type { Organizer, OrganizerStatus, Prisma } from '@prisma/client';
import type { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class OrganizerRepository {
  abstract create(
    data: Prisma.OrganizerCreateInput,
    options?: RepositoryOptions,
  ): Promise<Organizer>;

  abstract findOwnedByUser(
    params: { organizerId: string; ownerUserId: string },
    options?: RepositoryOptions,
  ): Promise<Organizer | null>;

  abstract listForOwner(
    ownerUserId: string,
    options?: RepositoryOptions,
  ): Promise<Organizer[]>;

  abstract update(
    id: string,
    data: Prisma.OrganizerUpdateInput,
    options?: RepositoryOptions,
  ): Promise<Organizer>;

  abstract setStatus(
    id: string,
    status: OrganizerStatus,
    options?: RepositoryOptions,
  ): Promise<Organizer>;
}
