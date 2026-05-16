import { randomUUID } from 'node:crypto';
import {
  EventStatus,
  OrganizerStatus,
  PaymentIntentStatus,
  PaymentProvider,
  Prisma,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import { TicketTokenService } from '../../src/modules/tickets/application/ticket-token.service';
import { RequestContextService } from '../../src/shared/context/request-context.service';
import { PrismaService } from '../../src/shared/prisma/prisma.service';

export type SeededPaymentIntentGraph = {
  buyerUserId: string;
  organizerOwnerUserId: string;
  organizerId: string;
  venueId: string;
  eventId: string;
  paymentIntentId: string;
  providerReference: string;
  amountMinor: number;
  currency: string;
};

export async function seedPaymentIntentGraph(
  prisma: PrismaService,
  overrides?: Partial<{
    buyerUserId: string;
    organizerOwnerUserId: string;
    organizerId: string;
    venueId: string;
    eventId: string;
    paymentIntentId: string;
    paymentIntentStatus: PaymentIntentStatus;
    provider: PaymentProvider;
    eventStatus: EventStatus;
    eventEndsAt: Date;
    amountMinor: number;
    currency: string;
  }>,
): Promise<SeededPaymentIntentGraph> {
  const buyerUserId = overrides?.buyerUserId ?? randomUUID();
  const organizerOwnerUserId = overrides?.organizerOwnerUserId ?? randomUUID();
  const organizerId = overrides?.organizerId ?? randomUUID();
  const venueId = overrides?.venueId ?? randomUUID();
  const eventId = overrides?.eventId ?? randomUUID();
  const paymentIntentId = overrides?.paymentIntentId ?? randomUUID();
  const amountMinor = overrides?.amountMinor ?? 5000;
  const currency = overrides?.currency ?? 'GHS';
  const eventEndsAt =
    overrides?.eventEndsAt ?? new Date('2026-07-01T23:30:00.000Z');
  const eventStatus = overrides?.eventStatus ?? EventStatus.PUBLISHED;
  const paymentIntentStatus =
    overrides?.paymentIntentStatus ?? PaymentIntentStatus.VERIFIED;
  const provider = overrides?.provider ?? PaymentProvider.PAYSTACK;
  const providerReference = `pi-${paymentIntentId}`;

  await prisma.user.createMany({
    data: [
      {
        id: buyerUserId,
        email: `buyer-${buyerUserId}@example.com`,
        passwordHash:
          '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        role: UserRole.CUSTOMER,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: organizerOwnerUserId,
        email: `organizer-${organizerOwnerUserId}@example.com`,
        passwordHash:
          '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        role: UserRole.ORGANIZER,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
  });

  await prisma.organizer.create({
    data: {
      id: organizerId,
      ownerUserId: organizerOwnerUserId,
      displayName: 'WS8 Organizer',
      slug: `organizer-${organizerId.slice(0, 8)}`,
      status: OrganizerStatus.APPROVED,
    },
  });

  await prisma.venue.create({
    data: {
      id: venueId,
    },
  });

  await prisma.event.create({
    data: {
      id: eventId,
      organizerId,
      venueId,
      title: 'WS8 Event',
      slug: `event-${eventId.slice(0, 8)}`,
      status: eventStatus,
      startsAt: new Date('2026-07-01T20:00:00.000Z'),
      endsAt: eventEndsAt,
      paymentEnabled: true,
      priceMinor: amountMinor,
      priceCurrency: currency,
      venueName: 'Accra Hall',
      city: 'Accra',
      country: 'Ghana',
      publishedAt:
        eventStatus === EventStatus.PUBLISHED
          ? new Date('2026-06-01T12:00:00.000Z')
          : null,
    },
  });

  await prisma.paymentIntent.create({
    data: {
      id: paymentIntentId,
      buyerUserId,
      organizerId,
      eventId,
      provider,
      status: paymentIntentStatus,
      amountMinor,
      currency,
      idempotencyUseCase: 'payments.initiate',
      idempotencyKeyHash: `key-${paymentIntentId}`,
      requestFingerprintHash: `fingerprint-${paymentIntentId}`,
      providerReference,
      verifiedAt:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED
          ? new Date('2026-06-01T12:30:00.000Z')
          : null,
      failedAt:
        paymentIntentStatus === PaymentIntentStatus.FAILED ||
        paymentIntentStatus === PaymentIntentStatus.INITIATION_FAILED
          ? new Date('2026-06-01T12:45:00.000Z')
          : null,
      providerVerifiedStatus:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED ? 'success' : null,
      providerVerifiedAmount:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED ? amountMinor : null,
      providerVerifiedCurrency:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED ? currency : null,
      providerVerificationRaw:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED
          ? ({ status: 'success' } as Prisma.JsonObject)
          : Prisma.JsonNull,
    },
  });

  return {
    buyerUserId,
    organizerOwnerUserId,
    organizerId,
    venueId,
    eventId,
    paymentIntentId,
    providerReference,
    amountMinor,
    currency,
  };
}

export async function seedIssuedTicket(
  prisma: PrismaService,
  ticketTokenService: TicketTokenService,
  input: {
    ownerUserId: string;
    organizerId: string;
    eventId: string;
    ticketTypeId: string;
    paymentIntentId?: string | null;
    status?: TicketStatus;
  },
): Promise<{ ticketId: string; token: string }> {
  const ticketId = randomUUID();
  const tokenMaterial = ticketTokenService.generateAdmissionToken();

  await prisma.ticket.create({
    data: {
      id: ticketId,
      ticketNumber: ticketTokenService.generateTicketNumber(),
      eventId: input.eventId,
      organizerId: input.organizerId,
      ticketTypeId: input.ticketTypeId,
      ownerUserId: input.ownerUserId,
      paymentIntentId: input.paymentIntentId ?? null,
      status: input.status ?? TicketStatus.ISSUED,
      admissionTokenHash: tokenMaterial.hash,
      admissionTokenVersion: tokenMaterial.version,
      ticketSerial: `SER-${ticketId.slice(0, 8).toUpperCase()}`,
      publicReference: `GV-${ticketId.slice(0, 8).toUpperCase()}`,
      issuedAt: new Date('2026-06-01T12:30:00.000Z'),
    },
  });

  return {
    ticketId,
    token: tokenMaterial.token,
  };
}

export async function runWithUserContext<T>(
  requestContext: RequestContextService,
  userId: string,
  callback: () => Promise<T>,
): Promise<T> {
  return requestContext.run(
    {
      requestId: randomUUID(),
      correlationId: randomUUID(),
      userId,
    },
    callback,
  );
}