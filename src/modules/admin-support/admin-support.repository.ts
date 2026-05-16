import { Injectable } from '@nestjs/common';
import { AdminActionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { AdminLookupQueryDto } from './dto/admin-lookup-query.dto';

const userSelect = Prisma.validator<Prisma.UserSelect>()({
  id: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

const organizerSelect = Prisma.validator<Prisma.OrganizerSelect>()({
  id: true,
  ownerUserId: true,
  displayName: true,
  slug: true,
  status: true,
  contactEmail: true,
  contactPhone: true,
  createdAt: true,
  updatedAt: true,
});

const eventSelect = Prisma.validator<Prisma.EventSelect>()({
  id: true,
  organizerId: true,
  title: true,
  slug: true,
  status: true,
  visibility: true,
  category: true,
  startsAt: true,
  endsAt: true,
  venueName: true,
  city: true,
  country: true,
  paymentEnabled: true,
  priceMinor: true,
  priceCurrency: true,
  publishedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
});

const paymentSelect = Prisma.validator<Prisma.PaymentIntentSelect>()({
  id: true,
  buyerUserId: true,
  organizerId: true,
  eventId: true,
  provider: true,
  status: true,
  amountMinor: true,
  currency: true,
  providerReference: true,
  providerVerifiedStatus: true,
  providerVerifiedAmount: true,
  providerVerifiedCurrency: true,
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
  failedAt: true,
});

const ticketSelect = Prisma.validator<Prisma.TicketSelect>()({
  id: true,
  ticketNumber: true,
  ownerUserId: true,
  eventId: true,
  organizerId: true,
  paymentIntentId: true,
  status: true,
  issuedAt: true,
  usedAt: true,
  voidedAt: true,
  expiresAt: true,
});

const admissionScanSelect = Prisma.validator<Prisma.AdmissionScanAuditSelect>()({
  id: true,
  ticketId: true,
  eventId: true,
  organizerId: true,
  scannedByUserId: true,
  status: true,
  rejectionReason: true,
  deviceId: true,
  gateLabel: true,
  scannedAt: true,
});

const adminSupportAuditLogSelect =
  Prisma.validator<Prisma.AdminSupportAuditLogSelect>()({
    id: true,
    actorUserId: true,
    action: true,
    status: true,
    targetType: true,
    targetId: true,
    reasonCode: true,
    reasonNote: true,
    metadata: true,
    createdAt: true,
  });

export type AdminSupportListResult<T> = {
  items: T[];
  limit: number;
  offset: number;
  resultCount: number;
};

export type AdminUserRecord = Prisma.UserGetPayload<{
  select: typeof userSelect;
}>;

export type AdminOrganizerRecord = Prisma.OrganizerGetPayload<{
  select: typeof organizerSelect;
}>;

export type AdminEventRecord = Prisma.EventGetPayload<{
  select: typeof eventSelect;
}>;

export type AdminPaymentRecord = Prisma.PaymentIntentGetPayload<{
  select: typeof paymentSelect;
}>;

export type AdminTicketRecord = Prisma.TicketGetPayload<{
  select: typeof ticketSelect;
}>;

export type AdminAdmissionScanRecord = Prisma.AdmissionScanAuditGetPayload<{
  select: typeof admissionScanSelect;
}>;

export type AdminSupportAuditLogRecord = Prisma.AdminSupportAuditLogGetPayload<{
  select: typeof adminSupportAuditLogSelect;
}>;

export type CreateAdminSupportAuditLogInput = {
  actorUserId: string;
  action: string;
  status: AdminActionStatus;
  targetType?: string | null;
  targetId?: string | null;
  reasonCode: string;
  reasonNote?: string | null;
  metadata?: Prisma.InputJsonObject | null;
};

@Injectable()
export class AdminSupportRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResult<AdminUserRecord>> {
    const items = await this.prisma.user.findMany({
      where: this.buildUserWhere(query.search),
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: userSelect,
    });

    return this.toListResult(items, query);
  }

  async getUserById(userId: string): Promise<AdminUserRecord | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: userSelect,
    });
  }

  async listOrganizers(
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResult<AdminOrganizerRecord>> {
    const items = await this.prisma.organizer.findMany({
      where: this.buildOrganizerWhere(query.search),
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: organizerSelect,
    });

    return this.toListResult(items, query);
  }

  async getOrganizerById(
    organizerId: string,
  ): Promise<AdminOrganizerRecord | null> {
    return this.prisma.organizer.findUnique({
      where: { id: organizerId },
      select: organizerSelect,
    });
  }

  async listEvents(
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResult<AdminEventRecord>> {
    const items = await this.prisma.event.findMany({
      where: this.buildEventWhere(query.search),
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: eventSelect,
    });

    return this.toListResult(items, query);
  }

  async getEventById(eventId: string): Promise<AdminEventRecord | null> {
    return this.prisma.event.findUnique({
      where: { id: eventId },
      select: eventSelect,
    });
  }

  async listPayments(
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResult<AdminPaymentRecord>> {
    const items = await this.prisma.paymentIntent.findMany({
      where: this.buildPaymentWhere(query.search),
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: paymentSelect,
    });

    return this.toListResult(items, query);
  }

  async getPaymentById(
    paymentIntentId: string,
  ): Promise<AdminPaymentRecord | null> {
    return this.prisma.paymentIntent.findUnique({
      where: { id: paymentIntentId },
      select: paymentSelect,
    });
  }

  async listTickets(
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResult<AdminTicketRecord>> {
    const items = await this.prisma.ticket.findMany({
      where: this.buildTicketWhere(query.search),
      orderBy: { issuedAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: ticketSelect,
    });

    return this.toListResult(items, query);
  }

  async getTicketById(ticketId: string): Promise<AdminTicketRecord | null> {
    return this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: ticketSelect,
    });
  }

  async listAdmissionScans(
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResult<AdminAdmissionScanRecord>> {
    const items = await this.prisma.admissionScanAudit.findMany({
      where: this.buildAdmissionScanWhere(query.search),
      orderBy: { scannedAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: admissionScanSelect,
    });

    return this.toListResult(items, query);
  }

  async getAdmissionScanById(
    scanAuditId: string,
  ): Promise<AdminAdmissionScanRecord | null> {
    return this.prisma.admissionScanAudit.findUnique({
      where: { id: scanAuditId },
      select: admissionScanSelect,
    });
  }

  async listAuditLogs(
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResult<AdminSupportAuditLogRecord>> {
    const items = await this.prisma.adminSupportAuditLog.findMany({
      where: this.buildAdminSupportAuditLogWhere(query.search),
      orderBy: { createdAt: 'desc' },
      take: query.limit,
      skip: query.offset,
      select: adminSupportAuditLogSelect,
    });

    return this.toListResult(items, query);
  }

  async createAuditLog(input: CreateAdminSupportAuditLogInput): Promise<void> {
    await this.prisma.adminSupportAuditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        status: input.status,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        reasonCode: input.reasonCode,
        reasonNote: input.reasonNote ?? null,
        metadata: input.metadata ?? undefined,
      },
    });
  }

  private toListResult<T>(
    items: T[],
    query: AdminLookupQueryDto,
  ): AdminSupportListResult<T> {
    return {
      items,
      limit: query.limit,
      offset: query.offset,
      resultCount: items.length,
    };
  }

  private buildUserWhere(search?: string): Prisma.UserWhereInput | undefined {
    if (!search) {
      return undefined;
    }

    const filters: Prisma.UserWhereInput[] = [
      {
        email: {
          contains: search,
          mode: 'insensitive',
        },
      },
    ];

    if (isUuid(search)) {
      filters.push({ id: search });
    }

    return { OR: filters };
  }

  private buildOrganizerWhere(
    search?: string,
  ): Prisma.OrganizerWhereInput | undefined {
    if (!search) {
      return undefined;
    }

    const filters: Prisma.OrganizerWhereInput[] = [
      {
        displayName: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        slug: {
          contains: search,
          mode: 'insensitive',
        },
      },
    ];

    if (isUuid(search)) {
      filters.push({ id: search });
    }

    return { OR: filters };
  }

  private buildEventWhere(search?: string): Prisma.EventWhereInput | undefined {
    if (!search) {
      return undefined;
    }

    const filters: Prisma.EventWhereInput[] = [
      {
        title: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        slug: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        city: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        country: {
          contains: search,
          mode: 'insensitive',
        },
      },
    ];

    if (isUuid(search)) {
      filters.push({ id: search });
    }

    return { OR: filters };
  }

  private buildPaymentWhere(
    search?: string,
  ): Prisma.PaymentIntentWhereInput | undefined {
    if (!search) {
      return undefined;
    }

    const filters: Prisma.PaymentIntentWhereInput[] = [
      {
        providerReference: {
          contains: search,
          mode: 'insensitive',
        },
      },
    ];

    if (isUuid(search)) {
      filters.push({ id: search });
      filters.push({ buyerUserId: search });
      filters.push({ eventId: search });
    }

    return { OR: filters };
  }

  private buildTicketWhere(
    search?: string,
  ): Prisma.TicketWhereInput | undefined {
    if (!search) {
      return undefined;
    }

    const filters: Prisma.TicketWhereInput[] = [
      {
        ticketNumber: {
          contains: search,
          mode: 'insensitive',
        },
      },
    ];

    if (isUuid(search)) {
      filters.push({ id: search });
      filters.push({ ownerUserId: search });
      filters.push({ eventId: search });
    }

    return { OR: filters };
  }

  private buildAdmissionScanWhere(
    search?: string,
  ): Prisma.AdmissionScanAuditWhereInput | undefined {
    if (!search) {
      return undefined;
    }

    if (!isUuid(search)) {
      return { OR: [] };
    }

    return {
      OR: [
        { id: search },
        { ticketId: search },
        { eventId: search },
        { organizerId: search },
      ],
    };
  }

  private buildAdminSupportAuditLogWhere(
    search?: string,
  ): Prisma.AdminSupportAuditLogWhereInput | undefined {
    if (!search) {
      return undefined;
    }

    const filters: Prisma.AdminSupportAuditLogWhereInput[] = [
      {
        action: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        targetType: {
          contains: search,
          mode: 'insensitive',
        },
      },
      {
        reasonCode: {
          contains: search,
          mode: 'insensitive',
        },
      },
    ];

    const status = toAdminActionStatus(search);

    if (status) {
      filters.push({ status });
    }

    if (isUuid(search)) {
      filters.push({ actorUserId: search });
      filters.push({ targetId: search });
    }

    return { OR: filters };
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function toAdminActionStatus(value: string): AdminActionStatus | null {
  const upper = value.trim().toUpperCase();

  switch (upper) {
    case AdminActionStatus.SUCCEEDED:
      return AdminActionStatus.SUCCEEDED;
    case AdminActionStatus.REJECTED:
      return AdminActionStatus.REJECTED;
    case AdminActionStatus.FAILED:
      return AdminActionStatus.FAILED;
    default:
      return null;
  }
}
