import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EventTableStatus,
  EventStatus,
  OrganizerStatus,
  Prisma,
  VenueTableStatus,
} from '@prisma/client';
import { EventsService } from '../../events/application/events.service';
import { OrganizersService } from '../../organizers/application/organizers.service';
import {
  CreateEventTableDto,
} from '../contracts/requests/create-event-table.dto';
import {
  CreateFloorSectionDto,
} from '../contracts/requests/create-floor-section.dto';
import {
  CreateVenueTableDto,
} from '../contracts/requests/create-venue-table.dto';
import { EventTableResponseDto } from '../contracts/responses/event-table-response.dto';
import { TableResponseDto } from '../contracts/responses/table-response.dto';
import { TableAuditService } from './table-audit.service';
import { TableReservationsService } from './table-reservations.service';
import { TablesRepository } from '../infrastructure/tables.repository';
import { TransactionRunnerService } from '../../../shared/prisma/transaction-runner.service';

@Injectable()
export class TablesService {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly tables: TablesRepository,
    private readonly organizers: OrganizersService,
    private readonly events: EventsService,
    private readonly tableAudit: TableAuditService,
    private readonly tableReservations: TableReservationsService,
  ) {}

  async createFloorSection(
    actorUserId: string,
    dto: CreateFloorSectionDto,
  ) {
    await this.organizers.getOwned(dto.organizerId, actorUserId);

    try {
      return await this.tables.createFloorSection({
        organizerId: dto.organizerId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
      });
    } catch (error) {
      this.rethrowUniqueConflict(error, 'floor section already exists for organizer');
      throw error;
    }
  }

  async listFloorSections(organizerId: string, actorUserId: string) {
    await this.organizers.getOwned(organizerId, actorUserId);
    return this.tables.listFloorSectionsByOrganizer(organizerId);
  }

  async createVenueTable(
    actorUserId: string,
    dto: CreateVenueTableDto,
  ): Promise<TableResponseDto> {
    await this.organizers.getOwned(dto.organizerId, actorUserId);
    this.assertSeatCount(dto.seatCount);

    if (dto.floorSectionId) {
      const floorSection = await this.tables.findFloorSectionByOrganizer(
        dto.organizerId,
        dto.floorSectionId,
      );

      if (!floorSection) {
        throw new NotFoundException('floor section not found');
      }
    }

    try {
      const venueTable = await this.transactionRunner.runInTransaction(
        async (tx) => {
          const created = await this.tables.createVenueTable(
            {
              organizerId: dto.organizerId,
              floorSectionId: dto.floorSectionId ?? null,
              label: dto.label.trim(),
              seatCount: dto.seatCount,
              status: dto.status ?? VenueTableStatus.ACTIVE,
            },
            { tx },
          );

          await this.tableAudit.logVenueTableCreated(
            {
              actorUserId,
              organizerId: dto.organizerId,
              venueTableId: created.id,
              floorSectionId: dto.floorSectionId ?? null,
              label: created.label,
              seatCount: created.seatCount,
              status: created.status,
            },
            { tx },
          );

          return created;
        },
        { timeout: 10000 },
      );

      const created = await this.tables.findVenueTableById(venueTable.id);

      if (!created) {
        throw new NotFoundException('venue table not found');
      }

      return this.toTableResponse(created);
    } catch (error) {
      this.rethrowUniqueConflict(error, 'venue table label already exists for organizer');
      throw error;
    }
  }

  async listVenueTables(
    organizerId: string,
    actorUserId: string,
  ): Promise<TableResponseDto[]> {
    await this.organizers.getOwned(organizerId, actorUserId);
    const tables = await this.tables.listVenueTablesByOrganizer(organizerId);
    return tables.map((item) => this.toTableResponse(item));
  }

  async getVenueTable(
    venueTableId: string,
    actorUserId: string,
  ): Promise<TableResponseDto> {
    const venueTable = await this.tables.findVenueTableById(venueTableId);

    if (!venueTable) {
      throw new NotFoundException('venue table not found');
    }

    await this.organizers.getOwned(venueTable.organizerId, actorUserId);
    return this.toTableResponse(venueTable);
  }

  async createEventTable(
    actorUserId: string,
    dto: CreateEventTableDto,
  ): Promise<EventTableResponseDto> {
    await this.organizers.getOwned(dto.organizerId, actorUserId);
    this.assertPriceMinor(dto.priceMinor);
    this.assertCurrency(dto.currency);

    if (dto.status === EventTableStatus.HELD) {
      throw new BadRequestException('event table cannot be created in HELD status');
    }

    const event = await this.events.getOwned(dto.eventId, actorUserId);

    if (event.organizerId !== dto.organizerId) {
      throw new ConflictException('event does not belong to organizer');
    }

    const venueTable = await this.tables.findVenueTableByOrganizer(
      dto.organizerId,
      dto.venueTableId,
    );

    if (!venueTable) {
      throw new ConflictException('venue table does not belong to organizer');
    }

    const initialStatus =
      dto.status ??
      (venueTable.status === VenueTableStatus.ACTIVE
        ? EventTableStatus.AVAILABLE
        : EventTableStatus.UNAVAILABLE);

    try {
      const eventTable = await this.transactionRunner.runInTransaction(
        async (tx) => {
          const created = await this.tables.createEventTable(
            {
              organizerId: dto.organizerId,
              eventId: dto.eventId,
              venueTableId: dto.venueTableId,
              status: venueTable.status === VenueTableStatus.ACTIVE
                ? initialStatus
                : EventTableStatus.UNAVAILABLE,
              priceMinor: dto.priceMinor,
              currency: dto.currency.trim(),
            },
            { tx },
          );

          await this.tableAudit.logEventTableCreated(
            {
              actorUserId,
              organizerId: dto.organizerId,
              eventId: dto.eventId,
              eventTableId: created.id,
              venueTableId: dto.venueTableId,
              priceMinor: created.priceMinor,
              currency: created.currency,
              status: created.status,
            },
            { tx },
          );

          return created;
        },
        { timeout: 10000 },
      );

      const created = await this.tables.findOwnedEventTable(eventTable.id, actorUserId);

      if (!created) {
        throw new NotFoundException('event table not found');
      }

      return this.toEventTableResponse(created);
    } catch (error) {
      this.rethrowUniqueConflict(
        error,
        'event table already exists for this event and venue table',
      );
      throw error;
    }
  }

  async listEventTablesForOwnedEvent(
    eventId: string,
    actorUserId: string,
  ): Promise<EventTableResponseDto[]> {
    await this.events.getOwned(eventId, actorUserId);
    const tables = await this.tables.listEventTablesByEvent(eventId);
    return tables.map((item) => this.toEventTableResponse(item));
  }

  async updateEventTableStatus(
    eventTableId: string,
    status: EventTableStatus,
    actorUserId: string,
  ): Promise<EventTableResponseDto> {
    if (status === EventTableStatus.HELD) {
      throw new BadRequestException('HELD status is derived from active table holds');
    }

    const existing = await this.tables.findOwnedEventTable(eventTableId, actorUserId);

    if (!existing) {
      throw new NotFoundException('event table not found');
    }

    if (
      status === EventTableStatus.AVAILABLE &&
      existing.venueTable.status !== VenueTableStatus.ACTIVE
    ) {
      throw new BadRequestException('inactive venue table cannot be made available');
    }

    const now = new Date();

    const updated = await this.transactionRunner.runInTransaction(
      async (tx) => {
        const locked = await this.tables.lockEventTableForUpdate(tx, eventTableId);

        if (!locked) {
          throw new NotFoundException('event table not found');
        }

        await this.tableReservations.expireStaleHoldForEventTableWithinTx(
          tx,
          eventTableId,
          now,
        );

        const activeCount =
          await this.tableReservations.countActiveHeldReservationsForEventTable(
            tx,
            eventTableId,
            now,
          );

        if (activeCount > 0) {
          throw new ConflictException('active table hold prevents status change');
        }

        const changed = await this.tables.updateEventTableState(
          eventTableId,
          {
            status,
            holdExpiresAt: null,
          },
          { tx },
        );

        await this.tableAudit.logEventTableUpdated(
          {
            actorUserId,
            organizerId: existing.organizerId,
            eventId: existing.eventId,
            eventTableId,
            venueTableId: existing.venueTableId,
            previousStatus: existing.status,
            newStatus: changed.status,
          },
          { tx },
        );

        return changed;
      },
      { timeout: 10000 },
    );

    const refreshed = await this.tables.findOwnedEventTable(updated.id, actorUserId);

    if (!refreshed) {
      throw new NotFoundException('event table not found');
    }

    return this.toEventTableResponse(refreshed);
  }

  async getAvailability(eventId: string): Promise<
    Array<{
      eventTableId: string;
      venueTableId: string;
      label: string;
      floorSectionName: string | null;
      seatCount: number;
      priceMinor: number;
      currency: string;
      availabilityStatus: EventTableStatus;
    }>
  > {
    const now = new Date();

    return this.transactionRunner.runInTransaction(
      async (tx) => {
        const event = await this.tables.findCustomerEventScope(eventId, { tx });

        if (!event) {
          throw new NotFoundException('event not found');
        }

        if (event.status !== EventStatus.PUBLISHED) {
          throw new ForbiddenException('event is not available');
        }

        if (event.visibility !== 'PUBLIC') {
          throw new ForbiddenException('event is not customer facing');
        }

        if (event.endsAt <= now) {
          throw new ForbiddenException('event has ended');
        }

        if (event.organizer.status !== OrganizerStatus.APPROVED) {
          throw new ForbiddenException('organizer is not approved');
        }

        const locked = await this.tables.lockEventTablesForEventForUpdate(tx, eventId);

        for (const row of locked) {
          await this.tableReservations.expireStaleHoldForEventTableWithinTx(
            tx,
            row.id,
            now,
          );
        }

        const records = await this.tables.listEventTablesForAvailability(eventId, {
          tx,
        });

        return records.map((record) => ({
          eventTableId: record.id,
          venueTableId: record.venueTableId,
          label: record.venueTable.label,
          floorSectionName: record.venueTable.floorSection?.name ?? null,
          seatCount: record.venueTable.seatCount,
          priceMinor: record.priceMinor,
          currency: record.currency,
          availabilityStatus:
            record.venueTable.status !== VenueTableStatus.ACTIVE
              ? EventTableStatus.UNAVAILABLE
              : record.status,
        }));
      },
      { timeout: 15000 },
    );
  }

  private assertSeatCount(seatCount: number): void {
    if (!Number.isInteger(seatCount) || seatCount <= 0) {
      throw new BadRequestException('seatCount must be greater than 0');
    }
  }

  private assertPriceMinor(priceMinor: number): void {
    if (!Number.isInteger(priceMinor) || priceMinor < 0) {
      throw new BadRequestException('priceMinor must be greater than or equal to 0');
    }
  }

  private assertCurrency(currency: string): void {
    if (!/^[A-Z]{3}$/.test(currency.trim())) {
      throw new BadRequestException('currency must be a 3-letter uppercase code');
    }
  }

  private toTableResponse(
    table: import('../infrastructure/tables.repository').VenueTableViewRecord,
  ): TableResponseDto {
    return {
      id: table.id,
      organizerId: table.organizerId,
      floorSectionId: table.floorSectionId,
      floorSectionName: table.floorSection?.name ?? null,
      label: table.label,
      seatCount: table.seatCount,
      status: table.status,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    };
  }

  private toEventTableResponse(
    table: import('../infrastructure/tables.repository').EventTableViewRecord,
  ): EventTableResponseDto {
    return {
      id: table.id,
      organizerId: table.organizerId,
      eventId: table.eventId,
      venueTableId: table.venueTableId,
      label: table.venueTable.label,
      floorSectionName: table.venueTable.floorSection?.name ?? null,
      seatCount: table.venueTable.seatCount,
      priceMinor: table.priceMinor,
      currency: table.currency,
      status:
        table.venueTable.status !== VenueTableStatus.ACTIVE
          ? EventTableStatus.UNAVAILABLE
          : table.status,
      holdExpiresAt: table.holdExpiresAt,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    };
  }

  private rethrowUniqueConflict(error: unknown, message: string): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(message);
    }
  }
}