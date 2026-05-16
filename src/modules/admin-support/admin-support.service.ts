import { Injectable, NotFoundException } from '@nestjs/common';
import { AdminSupportAuditService } from './admin-support-audit.service';
import {
  AdminAdmissionScanRecord,
  AdminEventRecord,
  AdminOrganizerRecord,
  AdminPaymentRecord,
  AdminSupportAuditLogRecord,
  AdminSupportListResult,
  AdminSupportRepository,
  AdminTicketRecord,
  AdminUserRecord,
} from './admin-support.repository';
import { AdminSupportRedactionService } from './admin-support-redaction.service';
import { AdminLookupQueryDto } from './dto/admin-lookup-query.dto';
import { AdminAdmissionAuditResponseDto } from './dto/admin-admission-audit-response.dto';
import { AdminEventResponseDto } from './dto/admin-event-response.dto';
import { AdminOrganizerResponseDto } from './dto/admin-organizer-response.dto';
import { AdminPaymentResponseDto } from './dto/admin-payment-response.dto';
import { AdminSupportAuditLogResponseDto } from './dto/admin-support-audit-log-response.dto';
import { AdminTicketResponseDto } from './dto/admin-ticket-response.dto';
import { AdminUserResponseDto } from './dto/admin-user-response.dto';

export type AdminSupportListResponse<T> = {
  items: T[];
  limit: number;
  offset: number;
  resultCount: number;
};

const SUPPORT_ACTIONS = {
  user: 'admin_support_read_user',
  organizer: 'admin_support_read_organizer',
  event: 'admin_support_read_event',
  payment: 'admin_support_read_payment',
  ticket: 'admin_support_read_ticket',
  admissionScan: 'admin_support_read_admission_scan',
  auditLog: 'admin_support_read_audit_log',
} as const;

const SUPPORT_TARGET_TYPES = {
  user: 'user',
  organizer: 'organizer',
  event: 'event',
  payment: 'payment_intent',
  ticket: 'ticket',
  admissionScan: 'admission_scan_audit',
  auditLog: 'admin_support_audit_log',
} as const;

@Injectable()
export class AdminSupportService {
  constructor(
    private readonly repository: AdminSupportRepository,
    private readonly audit: AdminSupportAuditService,
    private readonly redaction: AdminSupportRedactionService,
  ) {}

  async listUsers(
    actorUserId: string,
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminUserResponseDto>> {
    const result = await this.repository.listUsers(query);

    return this.auditListAndReturn<AdminUserRecord, AdminUserResponseDto>({
      actorUserId,
      action: SUPPORT_ACTIONS.user,
      route: 'GET /admin/support/users',
      targetType: SUPPORT_TARGET_TYPES.user,
      query,
      result,
      mapItem: (item) => this.toUserResponse(item),
    });
  }

  async getUser(
    actorUserId: string,
    userId: string,
  ): Promise<AdminUserResponseDto> {
    const user = await this.repository.getUserById(userId);

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return this.auditDetailAndReturn({
      actorUserId,
      action: SUPPORT_ACTIONS.user,
      route: 'GET /admin/support/users/:userId',
      targetType: SUPPORT_TARGET_TYPES.user,
      targetId: userId,
      payload: this.toUserResponse(user),
    });
  }

  async listOrganizers(
    actorUserId: string,
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminOrganizerResponseDto>> {
    const result = await this.repository.listOrganizers(query);

    return this.auditListAndReturn<
      AdminOrganizerRecord,
      AdminOrganizerResponseDto
    >({
      actorUserId,
      action: SUPPORT_ACTIONS.organizer,
      route: 'GET /admin/support/organizers',
      targetType: SUPPORT_TARGET_TYPES.organizer,
      query,
      result,
      mapItem: (item) => this.toOrganizerResponse(item),
    });
  }

  async getOrganizer(
    actorUserId: string,
    organizerId: string,
  ): Promise<AdminOrganizerResponseDto> {
    const organizer = await this.repository.getOrganizerById(organizerId);

    if (!organizer) {
      throw new NotFoundException('Organizer not found.');
    }

    return this.auditDetailAndReturn({
      actorUserId,
      action: SUPPORT_ACTIONS.organizer,
      route: 'GET /admin/support/organizers/:organizerId',
      targetType: SUPPORT_TARGET_TYPES.organizer,
      targetId: organizerId,
      payload: this.toOrganizerResponse(organizer),
    });
  }

  async listEvents(
    actorUserId: string,
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminEventResponseDto>> {
    const result = await this.repository.listEvents(query);

    return this.auditListAndReturn<AdminEventRecord, AdminEventResponseDto>({
      actorUserId,
      action: SUPPORT_ACTIONS.event,
      route: 'GET /admin/support/events',
      targetType: SUPPORT_TARGET_TYPES.event,
      query,
      result,
      mapItem: (item) => this.toEventResponse(item),
    });
  }

  async getEvent(
    actorUserId: string,
    eventId: string,
  ): Promise<AdminEventResponseDto> {
    const event = await this.repository.getEventById(eventId);

    if (!event) {
      throw new NotFoundException('Event not found.');
    }

    return this.auditDetailAndReturn({
      actorUserId,
      action: SUPPORT_ACTIONS.event,
      route: 'GET /admin/support/events/:eventId',
      targetType: SUPPORT_TARGET_TYPES.event,
      targetId: eventId,
      payload: this.toEventResponse(event),
    });
  }

  async listPayments(
    actorUserId: string,
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminPaymentResponseDto>> {
    const result = await this.repository.listPayments(query);

    return this.auditListAndReturn<AdminPaymentRecord, AdminPaymentResponseDto>({
      actorUserId,
      action: SUPPORT_ACTIONS.payment,
      route: 'GET /admin/support/payments',
      targetType: SUPPORT_TARGET_TYPES.payment,
      query,
      result,
      mapItem: (item) => this.toPaymentResponse(item),
    });
  }

  async getPayment(
    actorUserId: string,
    paymentIntentId: string,
  ): Promise<AdminPaymentResponseDto> {
    const payment = await this.repository.getPaymentById(paymentIntentId);

    if (!payment) {
      throw new NotFoundException('Payment intent not found.');
    }

    return this.auditDetailAndReturn({
      actorUserId,
      action: SUPPORT_ACTIONS.payment,
      route: 'GET /admin/support/payments/:paymentIntentId',
      targetType: SUPPORT_TARGET_TYPES.payment,
      targetId: paymentIntentId,
      payload: this.toPaymentResponse(payment),
    });
  }

  async listTickets(
    actorUserId: string,
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminTicketResponseDto>> {
    const result = await this.repository.listTickets(query);

    return this.auditListAndReturn<AdminTicketRecord, AdminTicketResponseDto>({
      actorUserId,
      action: SUPPORT_ACTIONS.ticket,
      route: 'GET /admin/support/tickets',
      targetType: SUPPORT_TARGET_TYPES.ticket,
      query,
      result,
      mapItem: (item) => this.toTicketResponse(item),
    });
  }

  async getTicket(
    actorUserId: string,
    ticketId: string,
  ): Promise<AdminTicketResponseDto> {
    const ticket = await this.repository.getTicketById(ticketId);

    if (!ticket) {
      throw new NotFoundException('Ticket not found.');
    }

    return this.auditDetailAndReturn({
      actorUserId,
      action: SUPPORT_ACTIONS.ticket,
      route: 'GET /admin/support/tickets/:ticketId',
      targetType: SUPPORT_TARGET_TYPES.ticket,
      targetId: ticketId,
      payload: this.toTicketResponse(ticket),
    });
  }

  async listAdmissionScans(
    actorUserId: string,
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminAdmissionAuditResponseDto>> {
    const result = await this.repository.listAdmissionScans(query);

    return this.auditListAndReturn<
      AdminAdmissionScanRecord,
      AdminAdmissionAuditResponseDto
    >({
      actorUserId,
      action: SUPPORT_ACTIONS.admissionScan,
      route: 'GET /admin/support/admission-scans',
      targetType: SUPPORT_TARGET_TYPES.admissionScan,
      query,
      result,
      mapItem: (item) => this.toAdmissionScanResponse(item),
    });
  }

  async getAdmissionScan(
    actorUserId: string,
    scanAuditId: string,
  ): Promise<AdminAdmissionAuditResponseDto> {
    const admissionScan = await this.repository.getAdmissionScanById(scanAuditId);

    if (!admissionScan) {
      throw new NotFoundException('Admission scan audit not found.');
    }

    return this.auditDetailAndReturn({
      actorUserId,
      action: SUPPORT_ACTIONS.admissionScan,
      route: 'GET /admin/support/admission-scans/:scanAuditId',
      targetType: SUPPORT_TARGET_TYPES.admissionScan,
      targetId: scanAuditId,
      payload: this.toAdmissionScanResponse(admissionScan),
    });
  }

  async listAuditLogs(
    actorUserId: string,
    query: AdminLookupQueryDto,
  ): Promise<AdminSupportListResponse<AdminSupportAuditLogResponseDto>> {
    const result = await this.repository.listAuditLogs(query);

    return this.auditListAndReturn<
      AdminSupportAuditLogRecord,
      AdminSupportAuditLogResponseDto
    >({
      actorUserId,
      action: SUPPORT_ACTIONS.auditLog,
      route: 'GET /admin/support/audit-logs',
      targetType: SUPPORT_TARGET_TYPES.auditLog,
      query,
      result,
      mapItem: (item) => this.toAuditLogResponse(item),
    });
  }

  private async auditListAndReturn<TRecord, TPayload>(input: {
    actorUserId: string;
    action: string;
    route: string;
    targetType: string;
    query: AdminLookupQueryDto;
    result: AdminSupportListResult<TRecord>;
    mapItem: (item: TRecord) => TPayload;
  }): Promise<AdminSupportListResponse<TPayload>> {
    const payload: AdminSupportListResponse<TPayload> = {
      items: input.result.items.map((item) =>
        this.redaction.redactResponse(input.mapItem(item)),
      ),
      limit: input.result.limit,
      offset: input.result.offset,
      resultCount: input.result.resultCount,
    };

    await this.audit.recordRead({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: null,
      metadata: {
        route: input.route,
        routeAction: input.action,
        limit: payload.limit,
        offset: payload.offset,
        resultCount: payload.resultCount,
        safeFilterNames: input.query.search ? ['search'] : [],
        filters: input.query.search ? { search: input.query.search } : {},
        targetType: input.targetType,
      },
    });

    return payload;
  }

  private async auditDetailAndReturn<TPayload>(input: {
    actorUserId: string;
    action: string;
    route: string;
    targetType: string;
    targetId: string;
    payload: TPayload;
  }): Promise<TPayload> {
    const payload = this.redaction.redactResponse(input.payload);

    await this.audit.recordRead({
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: {
        route: input.route,
        routeAction: input.action,
        limit: 1,
        offset: 0,
        resultCount: 1,
        targetType: input.targetType,
        targetId: input.targetId,
      },
    });

    return payload;
  }

  private toUserResponse(record: AdminUserRecord): AdminUserResponseDto {
    return {
      id: record.id,
      email: record.email,
      role: record.role,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toOrganizerResponse(
    record: AdminOrganizerRecord,
  ): AdminOrganizerResponseDto {
    return {
      id: record.id,
      ownerUserId: record.ownerUserId,
      displayName: record.displayName,
      slug: record.slug,
      status: record.status,
      contactEmail: record.contactEmail ?? null,
      contactPhone: record.contactPhone ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toEventResponse(record: AdminEventRecord): AdminEventResponseDto {
    return {
      id: record.id,
      organizerId: record.organizerId,
      title: record.title,
      slug: record.slug,
      status: record.status,
      visibility: record.visibility,
      category: record.category,
      startsAt: record.startsAt,
      endsAt: record.endsAt,
      venueName: record.venueName ?? null,
      city: record.city ?? null,
      country: record.country,
      paymentEnabled: record.paymentEnabled,
      priceMinor: record.priceMinor ?? null,
      priceCurrency: record.priceCurrency,
      publishedAt: record.publishedAt ?? null,
      cancelledAt: record.cancelledAt ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toPaymentResponse(record: AdminPaymentRecord): AdminPaymentResponseDto {
    return {
      id: record.id,
      buyerUserId: record.buyerUserId,
      organizerId: record.organizerId,
      eventId: record.eventId,
      provider: record.provider,
      status: record.status,
      amountMinor: record.amountMinor,
      currency: record.currency,
      providerReference: record.providerReference,
      providerVerifiedStatus: record.providerVerifiedStatus ?? null,
      providerVerifiedAmount: record.providerVerifiedAmount ?? null,
      providerVerifiedCurrency: record.providerVerifiedCurrency ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      verifiedAt: record.verifiedAt ?? null,
      failedAt: record.failedAt ?? null,
    };
  }

  private toTicketResponse(record: AdminTicketRecord): AdminTicketResponseDto {
    return {
      id: record.id,
      ticketNumber: record.ticketNumber ?? null,
      ownerUserId: record.ownerUserId,
      eventId: record.eventId,
      organizerId: record.organizerId ?? null,
      paymentIntentId: record.paymentIntentId ?? null,
      status: record.status,
      issuedAt: record.issuedAt,
      usedAt: record.usedAt ?? null,
      voidedAt: record.voidedAt ?? null,
      expiresAt: record.expiresAt ?? null,
    };
  }

  private toAdmissionScanResponse(
    record: AdminAdmissionScanRecord,
  ): AdminAdmissionAuditResponseDto {
    return {
      id: record.id,
      ticketId: record.ticketId ?? null,
      eventId: record.eventId ?? null,
      organizerId: record.organizerId ?? null,
      scannedByUserId: record.scannedByUserId ?? null,
      status: record.status,
      rejectionReason: record.rejectionReason ?? null,
      deviceId: record.deviceId ?? null,
      gateLabel: record.gateLabel ?? null,
      scannedAt: record.scannedAt,
    };
  }

  private toAuditLogResponse(
    record: AdminSupportAuditLogRecord,
  ): AdminSupportAuditLogResponseDto {
    return {
      id: record.id,
      actorUserId: record.actorUserId,
      action: record.action,
      status: record.status,
      targetType: record.targetType ?? null,
      targetId: record.targetId ?? null,
      reasonCode: record.reasonCode,
      reasonNote: record.reasonNote ?? null,
      metadata:
        record.metadata && typeof record.metadata === 'object'
          ? (this.redaction.redactResponse(record.metadata) as Record<
              string,
              unknown
            >)
          : null,
      createdAt: record.createdAt,
    };
  }
}
