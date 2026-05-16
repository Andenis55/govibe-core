import { Injectable } from '@nestjs/common';
import { Event, EventStatus, Prisma } from '@prisma/client';
import {
  EventRepository,
  OwnedEventRecord,
  PaymentInitiationEventRecord,
} from '../../domain/repositories/event.repository.interface';
import {
  RepositoryOptions,
  resolveDbClient,
} from '../../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../../shared/prisma/prisma.service';

@Injectable()
export class PrismaEventRepository implements EventRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Prisma.EventCreateInput,
    options?: RepositoryOptions,
  ): Promise<Event> {
    const db = resolveDbClient(this.prisma, options);

    return db.event.create({ data });
  }

  findOwnedByUser(
    params: { eventId: string; ownerUserId: string },
    options?: RepositoryOptions,
  ): Promise<OwnedEventRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.event.findFirst({
      where: {
        id: params.eventId,
        organizer: {
          ownerUserId: params.ownerUserId,
        },
      },
      include: {
        organizer: true,
      },
    });
  }

  listForOrganizer(
    organizerId: string,
    options?: RepositoryOptions,
  ): Promise<Event[]> {
    const db = resolveDbClient(this.prisma, options);

    return db.event.findMany({
      where: { organizerId },
      orderBy: { startsAt: 'asc' },
    });
  }

  findByIdForPaymentInitiation(
    eventId: string,
    options?: RepositoryOptions,
  ): Promise<PaymentInitiationEventRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.event.findUnique({
      where: { id: eventId },
      include: {
        organizer: true,
      },
    });
  }

  update(
    id: string,
    data: Prisma.EventUpdateInput,
    options?: RepositoryOptions,
  ): Promise<Event> {
    const db = resolveDbClient(this.prisma, options);

    return db.event.update({
      where: { id },
      data,
    });
  }

  setStatus(
    id: string,
    data: {
      status: EventStatus;
      publishedAt?: Date | null;
      cancelledAt?: Date | null;
      archivedAt?: Date | null;
    },
    options?: RepositoryOptions,
  ): Promise<Event> {
    const db = resolveDbClient(this.prisma, options);

    return db.event.update({
      where: { id },
      data,
    });
  }
}