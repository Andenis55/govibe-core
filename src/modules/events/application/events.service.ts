import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Event,
  EventCategory,
  EventStatus,
  EventVisibility,
  OrganizerStatus,
  Prisma,
} from '@prisma/client';
import { EVENT_REPOSITORY } from '../events.tokens';
import { CancelEventRequestDto } from '../contracts/requests/cancel-event.request.dto';
import { CreateEventRequestDto } from '../contracts/requests/create-event.request.dto';
import { PublishEventRequestDto } from '../contracts/requests/publish-event.request.dto';
import { UpdateEventRequestDto } from '../contracts/requests/update-event.request.dto';
import {
  EventRepository,
  OwnedEventRecord,
} from '../domain/repositories/event.repository.interface';
import { OrganizersService } from '../../organizers/application/organizers.service';

@Injectable()
export class EventsService {
  constructor(
    @Inject(EVENT_REPOSITORY)
    private readonly events: EventRepository,
    private readonly organizers: OrganizersService,
  ) {}

  async createForOrganizer(params: {
    organizerId: string;
    ownerUserId: string;
    dto: CreateEventRequestDto;
  }): Promise<Event> {
    await this.organizers.assertApprovedOwned(
      params.organizerId,
      params.ownerUserId,
    );

    this.assertValidDateRange(params.dto.startsAt, params.dto.endsAt);

    try {
      return await this.events.create({
        organizer: {
          connect: {
            id: params.organizerId,
          },
        },
        venue: {
          create: {},
        },
        title: params.dto.title.trim(),
        slug: params.dto.slug.toLowerCase().trim(),
        description: params.dto.description?.trim(),
        status: EventStatus.DRAFT,
        visibility: params.dto.visibility ?? EventVisibility.PRIVATE,
        category: params.dto.category ?? EventCategory.OTHER,
        startsAt: new Date(params.dto.startsAt),
        endsAt: new Date(params.dto.endsAt),
        timezone: params.dto.timezone?.trim() ?? 'Africa/Accra',
        venueName: params.dto.venueName?.trim(),
        addressLine1: params.dto.addressLine1?.trim(),
        addressLine2: params.dto.addressLine2?.trim(),
        city: params.dto.city?.trim(),
        region: params.dto.region?.trim(),
        country: params.dto.country?.trim() ?? 'Ghana',
        latitude: this.toDecimal(params.dto.latitude),
        longitude: this.toDecimal(params.dto.longitude),
        capacityTotal: params.dto.capacityTotal ?? null,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('event slug already exists for organizer');
      }

      throw error;
    }
  }

  async listForOwnedOrganizer(params: {
    organizerId: string;
    ownerUserId: string;
  }): Promise<Event[]> {
    await this.organizers.getOwned(params.organizerId, params.ownerUserId);
    return this.events.listForOrganizer(params.organizerId);
  }

  async getOwned(
    eventId: string,
    ownerUserId: string,
  ): Promise<OwnedEventRecord> {
    const event = await this.events.findOwnedByUser({
      eventId,
      ownerUserId,
    });

    if (!event) {
      throw new NotFoundException('event not found');
    }

    return event;
  }

  async updateOwned(params: {
    eventId: string;
    ownerUserId: string;
    dto: UpdateEventRequestDto;
  }): Promise<Event> {
    const event = await this.getOwned(params.eventId, params.ownerUserId);

    if (event.status === EventStatus.CANCELLED) {
      throw new ForbiddenException('cancelled event cannot be updated');
    }

    if (event.status === EventStatus.ARCHIVED) {
      throw new ForbiddenException('archived event cannot be updated');
    }

    const nextStartsAt = params.dto.startsAt ? new Date(params.dto.startsAt) : event.startsAt;
    const nextEndsAt = params.dto.endsAt ? new Date(params.dto.endsAt) : event.endsAt;

    this.assertValidDateRange(nextStartsAt, nextEndsAt);

    if (
      params.dto.capacityTotal !== undefined &&
      params.dto.capacityTotal < event.capacityHeld
    ) {
      throw new BadRequestException(
        'capacityTotal cannot be lower than currently held capacity',
      );
    }

    try {
      return await this.events.update(event.id, {
        title: params.dto.title?.trim(),
        slug: params.dto.slug?.toLowerCase().trim(),
        description: params.dto.description?.trim(),
        visibility: params.dto.visibility,
        category: params.dto.category,
        startsAt: params.dto.startsAt ? new Date(params.dto.startsAt) : undefined,
        endsAt: params.dto.endsAt ? new Date(params.dto.endsAt) : undefined,
        timezone: params.dto.timezone?.trim(),
        venueName: params.dto.venueName?.trim(),
        addressLine1: params.dto.addressLine1?.trim(),
        addressLine2: params.dto.addressLine2?.trim(),
        city: params.dto.city?.trim(),
        region: params.dto.region?.trim(),
        country: params.dto.country?.trim(),
        latitude: this.toDecimal(params.dto.latitude),
        longitude: this.toDecimal(params.dto.longitude),
        capacityTotal: params.dto.capacityTotal,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('event slug already exists for organizer');
      }

      throw error;
    }
  }

  async publishOwned(params: {
    eventId: string;
    ownerUserId: string;
    dto: PublishEventRequestDto;
  }): Promise<Event> {
    const event = await this.getOwned(params.eventId, params.ownerUserId);

    if (event.organizer.status !== OrganizerStatus.APPROVED) {
      throw new ForbiddenException('organizer is not approved');
    }

    if (event.status !== EventStatus.DRAFT) {
      throw new BadRequestException('only draft events can be published');
    }

    this.assertPublishable(event);

    return this.events.setStatus(event.id, {
      status: EventStatus.PUBLISHED,
      publishedAt: new Date(),
    });
  }

  async cancelOwned(params: {
    eventId: string;
    ownerUserId: string;
    dto: CancelEventRequestDto;
  }): Promise<Event> {
    const event = await this.getOwned(params.eventId, params.ownerUserId);

    if (event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('only published events can be cancelled');
    }

    return this.events.setStatus(event.id, {
      status: EventStatus.CANCELLED,
      cancelledAt: new Date(),
    });
  }

  private assertValidDateRange(
    startsAtInput: string | Date,
    endsAtInput: string | Date,
  ): void {
    const startsAt = new Date(startsAtInput);
    const endsAt = new Date(endsAtInput);

    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      throw new BadRequestException('invalid event date range');
    }

    if (endsAt.getTime() <= startsAt.getTime()) {
      throw new BadRequestException('event end time must be after start time');
    }
  }

  private assertPublishable(event: {
    title: string;
    startsAt: Date;
    endsAt: Date;
    capacityTotal: number | null;
    venueName: string | null;
    city: string | null;
    country: string;
  }): void {
    if (!event.title.trim()) {
      throw new BadRequestException('event title is required');
    }

    if (event.endsAt.getTime() <= event.startsAt.getTime()) {
      throw new BadRequestException('event end time must be after start time');
    }

    if (!event.venueName || !event.city || !event.country) {
      throw new BadRequestException('event location is required before publish');
    }

    if (!event.capacityTotal || event.capacityTotal < 1) {
      throw new BadRequestException('event capacity is required before publish');
    }
  }

  private toDecimal(value?: number): Prisma.Decimal | undefined {
    if (value === undefined) {
      return undefined;
    }

    return new Prisma.Decimal(value);
  }
}