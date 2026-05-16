import { Injectable } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import {
  resolveDbClient,
  TxClient,
} from '../../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import {
  AdmissionScanTicketRecord,
  CreateIssuedTicketInput,
  CreateTicketInput,
  TicketRepository,
  TicketViewRecord,
} from '../../domain/repositories/ticket.repository.interface';

@Injectable()
export class PrismaTicketRepository implements TicketRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateTicketInput, tx: TxClient): Promise<void> {
    await tx.ticket.create({
      data: {
        id: input.id,
        eventId: input.eventId,
        ticketTypeId: input.ticketTypeId ?? null,
        ownerUserId: input.ownerUserId,
        orderId: input.orderId,
        status: input.status,
        ticketSerial: input.ticketSerial,
        publicReference: input.publicReference,
      },
    });
  }

  async createMany(inputs: CreateTicketInput[], tx: TxClient): Promise<void> {
    if (inputs.length === 0) {
      return;
    }

    await tx.ticket.createMany({
      data: inputs.map((input) => ({
        id: input.id,
        eventId: input.eventId,
        ticketTypeId: input.ticketTypeId ?? null,
        ownerUserId: input.ownerUserId,
        orderId: input.orderId,
        status: input.status,
        ticketSerial: input.ticketSerial,
        publicReference: input.publicReference,
      })),
    });
  }

  async findById(ticketId: string, tx: TxClient) {
    return tx.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        eventId: true,
        ticketTypeId: true,
        ownerUserId: true,
        status: true,
        ticketSerial: true,
        publicReference: true,
      },
    });
  }

  async updateStatus(
    ticketId: string,
    status: TicketStatus,
    tx: TxClient,
  ): Promise<void> {
    await tx.ticket.update({
      where: { id: ticketId },
      data: { status },
    });
  }

  findOwnedByUser(ownerUserId: string): Promise<TicketViewRecord[]> {
    return this.prisma.ticket.findMany({
      where: { ownerUserId },
      orderBy: { issuedAt: 'desc' },
      select: {
        id: true,
        ticketNumber: true,
        ownerUserId: true,
        eventId: true,
        organizerId: true,
        status: true,
        issuedAt: true,
        usedAt: true,
        voidedAt: true,
        expiresAt: true,
        event: {
          select: {
            organizerId: true,
          },
        },
      },
    });
  }

  findOwnedById(
    params: { ticketId: string; ownerUserId: string },
  ): Promise<TicketViewRecord | null> {
    return this.prisma.ticket.findFirst({
      where: {
        id: params.ticketId,
        ownerUserId: params.ownerUserId,
      },
      select: {
        id: true,
        ticketNumber: true,
        ownerUserId: true,
        eventId: true,
        organizerId: true,
        status: true,
        issuedAt: true,
        usedAt: true,
        voidedAt: true,
        expiresAt: true,
        event: {
          select: {
            organizerId: true,
          },
        },
      },
    });
  }

  findByPaymentIntentOwnerAndEvent(
    params: {
      paymentIntentId: string;
      ownerUserId: string;
      eventId: string;
    },
    tx: TxClient,
  ): Promise<TicketViewRecord | null> {
    return tx.ticket.findFirst({
      where: {
        paymentIntentId: params.paymentIntentId,
        ownerUserId: params.ownerUserId,
        eventId: params.eventId,
      },
      select: {
        id: true,
        ticketNumber: true,
        ownerUserId: true,
        eventId: true,
        organizerId: true,
        status: true,
        issuedAt: true,
        usedAt: true,
        voidedAt: true,
        expiresAt: true,
        event: {
          select: {
            organizerId: true,
          },
        },
      },
    });
  }

  createIssuedTicket(
    input: CreateIssuedTicketInput,
    tx: TxClient,
  ): Promise<TicketViewRecord> {
    return tx.ticket.create({
      data: {
        id: input.id,
        ticketNumber: input.ticketNumber,
        eventId: input.eventId,
        organizerId: input.organizerId,
        ticketTypeId: null,
        ownerUserId: input.ownerUserId,
        orderId: null,
        paymentIntentId: input.paymentIntentId,
        status: TicketStatus.ISSUED,
        admissionTokenHash: input.admissionTokenHash,
        admissionTokenVersion: input.admissionTokenVersion ?? 1,
        ticketSerial: input.ticketSerial,
        publicReference: input.publicReference,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt ?? null,
      },
      select: {
        id: true,
        ticketNumber: true,
        ownerUserId: true,
        eventId: true,
        organizerId: true,
        status: true,
        issuedAt: true,
        usedAt: true,
        voidedAt: true,
        expiresAt: true,
        event: {
          select: {
            organizerId: true,
          },
        },
      },
    });
  }

  async appendIssuanceAudit(
    input: {
      paymentIntentId: string;
      ticketId?: string | null;
      buyerUserId: string;
      eventId: string;
      organizerId: string;
      auditEvent: string;
      reason?: string | null;
      metadata?: Prisma.InputJsonValue | null;
    },
    tx: TxClient,
  ): Promise<void> {
    await tx.ticketIssuanceAuditLog.create({
      data: {
        paymentIntentId: input.paymentIntentId,
        ticketId: input.ticketId ?? null,
        buyerUserId: input.buyerUserId,
        eventId: input.eventId,
        organizerId: input.organizerId,
        auditEvent: input.auditEvent,
        reason: input.reason ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
      },
    });
  }

  findForAdmissionScan(ticketId: string): Promise<AdmissionScanTicketRecord | null> {
    return this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        ownerUserId: true,
        eventId: true,
        organizerId: true,
        status: true,
        admissionTokenHash: true,
        expiresAt: true,
        usedAt: true,
        voidedAt: true,
        event: {
          select: {
            organizerId: true,
            status: true,
            endsAt: true,
            organizer: {
              select: {
                ownerUserId: true,
              },
            },
          },
        },
      },
    });
  }

  async markUsedIfIssuable(
    input: {
      ticketId: string;
      admissionTokenHash: string;
      usedAt: Date;
    },
    tx: TxClient,
  ): Promise<number> {
    const result = await tx.ticket.updateMany({
      where: {
        id: input.ticketId,
        status: TicketStatus.ISSUED,
        admissionTokenHash: input.admissionTokenHash,
      },
      data: {
        status: TicketStatus.USED,
        usedAt: input.usedAt,
      },
    });

    return result.count;
  }
}