import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Organizer, OrganizerStatus, Prisma } from '@prisma/client';
import { ORGANIZER_REPOSITORY } from '../organizers.tokens';
import { CreateOrganizerRequestDto } from '../contracts/requests/create-organizer.request.dto';
import { SubmitOrganizerRequestDto } from '../contracts/requests/submit-organizer.request.dto';
import { UpdateOrganizerRequestDto } from '../contracts/requests/update-organizer.request.dto';
import { OrganizerRepository } from '../domain/repositories/organizer.repository.interface';

@Injectable()
export class OrganizersService {
  constructor(
    @Inject(ORGANIZER_REPOSITORY)
    private readonly organizers: OrganizerRepository,
  ) {}

  async create(
    ownerUserId: string,
    dto: CreateOrganizerRequestDto,
  ): Promise<Organizer> {
    try {
      return await this.organizers.create({
        owner: {
          connect: { id: ownerUserId },
        },
        displayName: dto.displayName.trim(),
        slug: dto.slug.toLowerCase().trim(),
        description: dto.description?.trim(),
        contactEmail: dto.contactEmail?.toLowerCase().trim(),
        contactPhone: dto.contactPhone?.trim(),
        status: OrganizerStatus.DRAFT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('organizer slug already exists');
      }

      throw error;
    }
  }

  listMine(ownerUserId: string): Promise<Organizer[]> {
    return this.organizers.listForOwner(ownerUserId);
  }

  async getOwned(
    organizerId: string,
    ownerUserId: string,
  ): Promise<Organizer> {
    const organizer = await this.organizers.findOwnedByUser({
      organizerId,
      ownerUserId,
    });

    if (!organizer) {
      throw new NotFoundException('organizer not found');
    }

    return organizer;
  }

  async updateOwned(
    organizerId: string,
    ownerUserId: string,
    dto: UpdateOrganizerRequestDto,
  ): Promise<Organizer> {
    const organizer = await this.getOwned(organizerId, ownerUserId);

    if (organizer.status === OrganizerStatus.SUSPENDED) {
      throw new ForbiddenException('suspended organizer cannot be updated');
    }

    if (organizer.status === OrganizerStatus.REJECTED) {
      throw new ForbiddenException('rejected organizer cannot be updated');
    }

    try {
      return await this.organizers.update(organizer.id, {
        displayName: dto.displayName?.trim(),
        slug: dto.slug?.toLowerCase().trim(),
        description: dto.description?.trim(),
        contactEmail: dto.contactEmail?.toLowerCase().trim(),
        contactPhone: dto.contactPhone?.trim(),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('organizer slug already exists');
      }

      throw error;
    }
  }

  async submitForReview(
    organizerId: string,
    ownerUserId: string,
    _dto: SubmitOrganizerRequestDto,
  ): Promise<Organizer> {
    const organizer = await this.getOwned(organizerId, ownerUserId);

    if (organizer.status !== OrganizerStatus.DRAFT) {
      throw new BadRequestException(
        'only draft organizers can be submitted for review',
      );
    }

    return this.organizers.setStatus(
      organizer.id,
      OrganizerStatus.PENDING_REVIEW,
    );
  }

  async assertApprovedOwned(
    organizerId: string,
    ownerUserId: string,
  ): Promise<Organizer> {
    const organizer = await this.getOwned(organizerId, ownerUserId);

    if (organizer.status !== OrganizerStatus.APPROVED) {
      throw new ForbiddenException('organizer is not approved');
    }

    return organizer;
  }
}