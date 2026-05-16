import { Injectable } from '@nestjs/common';
import { EventTableStatus, Prisma, VenueFloorSection, VenueTable } from '@prisma/client';
import {
  RepositoryOptions,
  resolveDbClient,
  TxClient,
} from '../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../shared/prisma/prisma.service';

const venueTableViewInclude = Prisma.validator<Prisma.VenueTableInclude>()({
  floorSection: {
    select: {
      id: true,
      name: true,
    },
  },
});

const eventTableViewInclude = Prisma.validator<Prisma.EventTableInclude>()({
  organizer: {
    select: {
      id: true,
      status: true,
    },
  },
  event: {
    select: {
      id: true,
      organizerId: true,
      status: true,
      visibility: true,
      startsAt: true,
      endsAt: true,
    },
  },
  venueTable: {
    select: {
      id: true,
      organizerId: true,
      label: true,
      seatCount: true,
      status: true,
      floorSection: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
});

const customerEventScopeSelect = Prisma.validator<Prisma.EventSelect>()({
  id: true,
  organizerId: true,
  status: true,
  visibility: true,
  startsAt: true,
  endsAt: true,
  organizer: {
    select: {
      id: true,
      status: true,
    },
  },
});

const eventTableStateSelect = Prisma.validator<Prisma.EventTableSelect>()({
  id: true,
  status: true,
  holdExpiresAt: true,
});

const lockedEventTableSelect = Prisma.validator<Prisma.EventTableSelect>()({
  id: true,
  organizerId: true,
  eventId: true,
  venueTableId: true,
  status: true,
  priceMinor: true,
  currency: true,
  holdExpiresAt: true,
  organizer: {
    select: {
      id: true,
      status: true,
    },
  },
  event: {
    select: {
      id: true,
      organizerId: true,
      status: true,
      visibility: true,
      startsAt: true,
      endsAt: true,
    },
  },
  venueTable: {
    select: {
      id: true,
      organizerId: true,
      label: true,
      seatCount: true,
      status: true,
      floorSection: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
});

export type VenueTableViewRecord = Prisma.VenueTableGetPayload<{
  include: typeof venueTableViewInclude;
}>;

export type EventTableViewRecord = Prisma.EventTableGetPayload<{
  include: typeof eventTableViewInclude;
}>;

export type CustomerEventScope = Prisma.EventGetPayload<{
  select: typeof customerEventScopeSelect;
}>;

export type EventTableStateRecord = Prisma.EventTableGetPayload<{
  select: typeof eventTableStateSelect;
}>;

export type LockedEventTableRecord = Prisma.EventTableGetPayload<{
  select: typeof lockedEventTableSelect;
}>;

@Injectable()
export class TablesRepository {
  constructor(private readonly prisma: PrismaService) {}

  createFloorSection(
    data: Prisma.VenueFloorSectionUncheckedCreateInput,
    options?: RepositoryOptions,
  ): Promise<VenueFloorSection> {
    const db = resolveDbClient(this.prisma, options);

    return db.venueFloorSection.create({ data });
  }

  listFloorSectionsByOrganizer(
    organizerId: string,
    options?: RepositoryOptions,
  ): Promise<VenueFloorSection[]> {
    const db = resolveDbClient(this.prisma, options);

    return db.venueFloorSection.findMany({
      where: { organizerId },
      orderBy: { name: 'asc' },
    });
  }

  findFloorSectionByOrganizer(
    organizerId: string,
    floorSectionId: string,
    options?: RepositoryOptions,
  ): Promise<VenueFloorSection | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.venueFloorSection.findFirst({
      where: {
        id: floorSectionId,
        organizerId,
      },
    });
  }

  createVenueTable(
    data: Prisma.VenueTableUncheckedCreateInput,
    options?: RepositoryOptions,
  ): Promise<VenueTable> {
    const db = resolveDbClient(this.prisma, options);

    return db.venueTable.create({ data });
  }

  listVenueTablesByOrganizer(
    organizerId: string,
    options?: RepositoryOptions,
  ): Promise<VenueTableViewRecord[]> {
    const db = resolveDbClient(this.prisma, options);

    return db.venueTable.findMany({
      where: { organizerId },
      include: venueTableViewInclude,
      orderBy: { label: 'asc' },
    });
  }

  findVenueTableById(
    venueTableId: string,
    options?: RepositoryOptions,
  ): Promise<VenueTableViewRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.venueTable.findUnique({
      where: { id: venueTableId },
      include: venueTableViewInclude,
    });
  }

  findVenueTableByOrganizer(
    organizerId: string,
    venueTableId: string,
    options?: RepositoryOptions,
  ): Promise<VenueTableViewRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.venueTable.findFirst({
      where: {
        id: venueTableId,
        organizerId,
      },
      include: venueTableViewInclude,
    });
  }

  createEventTable(
    data: Prisma.EventTableUncheckedCreateInput,
    options?: RepositoryOptions,
  ) {
    const db = resolveDbClient(this.prisma, options);

    return db.eventTable.create({ data });
  }

  listEventTablesByEvent(
    eventId: string,
    options?: RepositoryOptions,
  ): Promise<EventTableViewRecord[]> {
    const db = resolveDbClient(this.prisma, options);

    return db.eventTable.findMany({
      where: { eventId },
      include: eventTableViewInclude,
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    });
  }

  findOwnedEventTable(
    eventTableId: string,
    ownerUserId: string,
    options?: RepositoryOptions,
  ): Promise<EventTableViewRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.eventTable.findFirst({
      where: {
        id: eventTableId,
        organizer: {
          ownerUserId,
        },
      },
      include: eventTableViewInclude,
    });
  }

  findCustomerEventScope(
    eventId: string,
    options?: RepositoryOptions,
  ): Promise<CustomerEventScope | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.event.findUnique({
      where: { id: eventId },
      select: customerEventScopeSelect,
    });
  }

  listEventTablesForAvailability(
    eventId: string,
    options?: RepositoryOptions,
  ): Promise<EventTableViewRecord[]> {
    const db = resolveDbClient(this.prisma, options);

    return db.eventTable.findMany({
      where: { eventId },
      include: eventTableViewInclude,
      orderBy: [{ priceMinor: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async lockEventTableForUpdate(
    tx: TxClient,
    eventTableId: string,
  ): Promise<{ id: string } | null> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM event_tables
      WHERE id = ${eventTableId}::uuid
      FOR UPDATE
    `);

    return rows[0] ?? null;
  }

  lockEventTablesForEventForUpdate(
    tx: TxClient,
    eventId: string,
  ): Promise<Array<{ id: string }>> {
    return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM event_tables
      WHERE event_id = ${eventId}::uuid
      ORDER BY id
      FOR UPDATE
    `);
  }

  findLockedEventTableDetails(
    tx: TxClient,
    eventTableId: string,
  ): Promise<LockedEventTableRecord | null> {
    return tx.eventTable.findUnique({
      where: { id: eventTableId },
      select: lockedEventTableSelect,
    });
  }

  findEventTableState(
    eventTableId: string,
    options?: RepositoryOptions,
  ): Promise<EventTableStateRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.eventTable.findUnique({
      where: { id: eventTableId },
      select: eventTableStateSelect,
    });
  }

  updateEventTableState(
    eventTableId: string,
    data: {
      status: EventTableStatus;
      holdExpiresAt: Date | null;
    },
    options?: RepositoryOptions,
  ) {
    const db = resolveDbClient(this.prisma, options);

    return db.eventTable.update({
      where: { id: eventTableId },
      data,
    });
  }
}