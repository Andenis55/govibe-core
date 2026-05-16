import type { Event, EventStatus, Prisma } from '@prisma/client';
import type { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export type OwnedEventRecord = Prisma.EventGetPayload<{
  include: { organizer: true };
}>;

export type PaymentInitiationEventRecord = OwnedEventRecord;

export abstract class EventRepository {
  abstract create(
    data: Prisma.EventCreateInput,
    options?: RepositoryOptions,
  ): Promise<Event>;

  abstract findOwnedByUser(
    params: { eventId: string; ownerUserId: string },
    options?: RepositoryOptions,
  ): Promise<OwnedEventRecord | null>;

  abstract listForOrganizer(
    organizerId: string,
    options?: RepositoryOptions,
  ): Promise<Event[]>;

  abstract findByIdForPaymentInitiation(
    eventId: string,
    options?: RepositoryOptions,
  ): Promise<PaymentInitiationEventRecord | null>;

  abstract update(
    id: string,
    data: Prisma.EventUpdateInput,
    options?: RepositoryOptions,
  ): Promise<Event>;

  abstract setStatus(
    id: string,
    data: {
      status: EventStatus;
      publishedAt?: Date | null;
      cancelledAt?: Date | null;
      archivedAt?: Date | null;
    },
    options?: RepositoryOptions,
  ): Promise<Event>;
}
