import { Inject, Injectable } from '@nestjs/common';
import { Organizer, OrganizerStatus, Prisma } from '@prisma/client';
import { OrganizerRepository } from '../../domain/repositories/organizer.repository.interface';
import {
  RepositoryOptions,
  resolveDbClient,
} from '../../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../../shared/prisma/prisma.service';

@Injectable()
export class PrismaOrganizerRepository implements OrganizerRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Prisma.OrganizerCreateInput,
    options?: RepositoryOptions,
  ): Promise<Organizer> {
    const db = resolveDbClient(this.prisma, options);

    return db.organizer.create({ data });
  }

  findOwnedByUser(
    params: { organizerId: string; ownerUserId: string },
    options?: RepositoryOptions,
  ): Promise<Organizer | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.organizer.findFirst({
      where: {
        id: params.organizerId,
        ownerUserId: params.ownerUserId,
      },
    });
  }

  listForOwner(
    ownerUserId: string,
    options?: RepositoryOptions,
  ): Promise<Organizer[]> {
    const db = resolveDbClient(this.prisma, options);

    return db.organizer.findMany({
      where: { ownerUserId },
      orderBy: { createdAt: 'desc' },
    });
  }

  update(
    id: string,
    data: Prisma.OrganizerUpdateInput,
    options?: RepositoryOptions,
  ): Promise<Organizer> {
    const db = resolveDbClient(this.prisma, options);

    return db.organizer.update({
      where: { id },
      data,
    });
  }

  setStatus(
    id: string,
    status: OrganizerStatus,
    options?: RepositoryOptions,
  ): Promise<Organizer> {
    const db = resolveDbClient(this.prisma, options);

    return db.organizer.update({
      where: { id },
      data: { status },
    });
  }
}