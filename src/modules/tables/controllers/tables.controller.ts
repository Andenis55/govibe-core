import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EventTableStatus } from '@prisma/client';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { AppPermission } from '../../../common/constants/permissions';
import { AuthUser } from '../../../common/types/auth-user.type';
import { CreateEventTableDto } from '../contracts/requests/create-event-table.dto';
import { CreateFloorSectionDto } from '../contracts/requests/create-floor-section.dto';
import { CreateVenueTableDto } from '../contracts/requests/create-venue-table.dto';
import { HoldTableDto } from '../contracts/requests/hold-table.dto';
import { EventTableResponseDto } from '../contracts/responses/event-table-response.dto';
import { TableReservationResponseDto } from '../contracts/responses/table-reservation-response.dto';
import { TableResponseDto } from '../contracts/responses/table-response.dto';
import { TableReservationsService } from '../application/table-reservations.service';
import { TablesService } from '../application/tables.service';

@Controller('tables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TablesController {
  constructor(
    private readonly tables: TablesService,
    private readonly tableReservations: TableReservationsService,
  ) {}

  @Post('floor-sections')
  @Permissions(AppPermission.TABLE_MANAGE_ORGANIZER)
  createFloorSection(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateFloorSectionDto,
  ) {
    return this.tables.createFloorSection(user.id, dto);
  }

  @Get('floor-sections')
  @Permissions(AppPermission.TABLE_READ_ORGANIZER)
  listFloorSections(
    @CurrentUser() user: AuthUser,
    @Query('organizerId', ParseUUIDPipe) organizerId: string,
  ) {
    return this.tables.listFloorSections(organizerId, user.id);
  }

  @Post('venue-tables')
  @Permissions(AppPermission.TABLE_MANAGE_ORGANIZER)
  createVenueTable(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateVenueTableDto,
  ): Promise<TableResponseDto> {
    return this.tables.createVenueTable(user.id, dto);
  }

  @Get('venue-tables')
  @Permissions(AppPermission.TABLE_READ_ORGANIZER)
  listVenueTables(
    @CurrentUser() user: AuthUser,
    @Query('organizerId', ParseUUIDPipe) organizerId: string,
  ): Promise<TableResponseDto[]> {
    return this.tables.listVenueTables(organizerId, user.id);
  }

  @Get('venue-tables/:venueTableId')
  @Permissions(AppPermission.TABLE_READ_ORGANIZER)
  getVenueTable(
    @CurrentUser() user: AuthUser,
    @Param('venueTableId', ParseUUIDPipe) venueTableId: string,
  ): Promise<TableResponseDto> {
    return this.tables.getVenueTable(venueTableId, user.id);
  }

  @Post('event-tables')
  @Permissions(AppPermission.TABLE_MANAGE_ORGANIZER)
  createEventTable(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEventTableDto,
  ): Promise<EventTableResponseDto> {
    return this.tables.createEventTable(user.id, dto);
  }

  @Get('events/:eventId/event-tables')
  @Permissions(AppPermission.TABLE_READ_ORGANIZER)
  listEventTables(
    @CurrentUser() user: AuthUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ): Promise<EventTableResponseDto[]> {
    return this.tables.listEventTablesForOwnedEvent(eventId, user.id);
  }

  @Patch('event-tables/:eventTableId/status')
  @Permissions(AppPermission.TABLE_MANAGE_ORGANIZER)
  updateEventTableStatus(
    @CurrentUser() user: AuthUser,
    @Param('eventTableId', ParseUUIDPipe) eventTableId: string,
    @Body('status', new ParseEnumPipe(EventTableStatus)) status: EventTableStatus,
  ): Promise<EventTableResponseDto> {
    return this.tables.updateEventTableStatus(eventTableId, status, user.id);
  }

  @Get('events/:eventId/availability')
  @Permissions(AppPermission.TABLE_READ_PUBLIC)
  getAvailability(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.tables.getAvailability(eventId);
  }

  @Post('events/:eventId/hold')
  @Permissions(AppPermission.TABLE_HOLD_OWN)
  createHold(
    @CurrentUser() user: AuthUser,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: HoldTableDto,
  ): Promise<TableReservationResponseDto> {
    return this.tableReservations.createHold({
      actorUserId: user.id,
      eventId,
      eventTableId: dto.eventTableId,
      idempotencyKey: dto.idempotencyKey,
    });
  }

  @Get('reservations/:reservationId')
  @Permissions(AppPermission.TABLE_READ_OWN_RESERVATION)
  getReservation(
    @CurrentUser() user: AuthUser,
    @Param('reservationId', ParseUUIDPipe) reservationId: string,
  ): Promise<TableReservationResponseDto> {
    return this.tableReservations.getOwnedReservation(reservationId, user.id);
  }
}