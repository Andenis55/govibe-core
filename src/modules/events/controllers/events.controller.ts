import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AppPermission } from '../../../common/constants/permissions';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { EventsService } from '../application/events.service';
import { CancelEventRequestDto } from '../contracts/requests/cancel-event.request.dto';
import { CreateEventRequestDto } from '../contracts/requests/create-event.request.dto';
import { PublishEventRequestDto } from '../contracts/requests/publish-event.request.dto';
import { UpdateEventRequestDto } from '../contracts/requests/update-event.request.dto';

@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post('organizers/:organizerId/events')
  @Permissions(AppPermission.EVENT_CREATE_OWN)
  createForOrganizer(
    @CurrentUser() user: { id: string },
    @Param('organizerId', ParseUUIDPipe) organizerId: string,
    @Body() dto: CreateEventRequestDto,
  ) {
    return this.events.createForOrganizer({
      organizerId,
      ownerUserId: user.id,
      dto,
    });
  }

  @Get('organizers/:organizerId/events')
  @Permissions(AppPermission.EVENT_READ_OWN)
  listForOrganizer(
    @CurrentUser() user: { id: string },
    @Param('organizerId', ParseUUIDPipe) organizerId: string,
  ) {
    return this.events.listForOwnedOrganizer({
      organizerId,
      ownerUserId: user.id,
    });
  }

  @Get('events/:eventId')
  @Permissions(AppPermission.EVENT_READ_OWN)
  getOwned(
    @CurrentUser() user: { id: string },
    @Param('eventId', ParseUUIDPipe) eventId: string,
  ) {
    return this.events.getOwned(eventId, user.id);
  }

  @Patch('events/:eventId')
  @Permissions(AppPermission.EVENT_UPDATE_OWN)
  updateOwned(
    @CurrentUser() user: { id: string },
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: UpdateEventRequestDto,
  ) {
    return this.events.updateOwned({
      eventId,
      ownerUserId: user.id,
      dto,
    });
  }

  @Post('events/:eventId/publish')
  @Permissions(AppPermission.EVENT_PUBLISH_OWN)
  publishOwned(
    @CurrentUser() user: { id: string },
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: PublishEventRequestDto,
  ) {
    return this.events.publishOwned({
      eventId,
      ownerUserId: user.id,
      dto,
    });
  }

  @Post('events/:eventId/cancel')
  @Permissions(AppPermission.EVENT_CANCEL_OWN)
  cancelOwned(
    @CurrentUser() user: { id: string },
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body() dto: CancelEventRequestDto,
  ) {
    return this.events.cancelOwned({
      eventId,
      ownerUserId: user.id,
      dto,
    });
  }
}