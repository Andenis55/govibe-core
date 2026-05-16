import { Prisma, TicketStatus } from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';

export type CreateTicketInput = {
  id: string;
  eventId: string;
  ticketTypeId?: string | null;
  ownerUserId: string;
  orderId?: string | null;
  status: TicketStatus;
  ticketSerial: string;
  publicReference: string;
};

export type TicketViewRecord = Prisma.TicketGetPayload<{
  select: {
    id: true;
    ticketNumber: true;
    ownerUserId: true;
    eventId: true;
    organizerId: true;
    status: true;
    issuedAt: true;
    usedAt: true;
    voidedAt: true;
    expiresAt: true;
    event: {
      select: {
        organizerId: true;
      };
    };
  };
}>;

export type AdmissionScanTicketRecord = Prisma.TicketGetPayload<{
  select: {
    id: true;
    ownerUserId: true;
    eventId: true;
    organizerId: true;
    status: true;
    admissionTokenHash: true;
    expiresAt: true;
    usedAt: true;
    voidedAt: true;
    event: {
      select: {
        organizerId: true;
        status: true;
        endsAt: true;
        organizer: {
          select: {
            ownerUserId: true;
          };
        };
      };
    };
  };
}>;

export type CreateIssuedTicketInput = {
  id: string;
  ticketNumber: string;
  ownerUserId: string;
  eventId: string;
  organizerId: string;
  paymentIntentId: string;
  admissionTokenHash: string;
  admissionTokenVersion?: number;
  issuedAt: Date;
  expiresAt?: Date | null;
  ticketSerial: string;
  publicReference: string;
};

export interface TicketRepository {
  create(input: CreateTicketInput, tx: TxClient): Promise<void>;
  createMany(inputs: CreateTicketInput[], tx: TxClient): Promise<void>;
  findById(
    ticketId: string,
    tx: TxClient,
  ): Promise<{
    id: string;
    eventId: string;
    ticketTypeId: string | null;
    ownerUserId: string;
    status: TicketStatus;
    ticketSerial: string;
    publicReference: string;
  } | null>;
  updateStatus(ticketId: string, status: TicketStatus, tx: TxClient): Promise<void>;
  findOwnedByUser(ownerUserId: string): Promise<TicketViewRecord[]>;
  findOwnedById(
    params: { ticketId: string; ownerUserId: string },
  ): Promise<TicketViewRecord | null>;
  findByPaymentIntentOwnerAndEvent(
    params: {
      paymentIntentId: string;
      ownerUserId: string;
      eventId: string;
    },
    tx: TxClient,
  ): Promise<TicketViewRecord | null>;
  createIssuedTicket(
    input: CreateIssuedTicketInput,
    tx: TxClient,
  ): Promise<TicketViewRecord>;
  appendIssuanceAudit(
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
  ): Promise<void>;
  findForAdmissionScan(ticketId: string): Promise<AdmissionScanTicketRecord | null>;
  markUsedIfIssuable(
    input: {
      ticketId: string;
      admissionTokenHash: string;
      usedAt: Date;
    },
    tx: TxClient,
  ): Promise<number>;
}
