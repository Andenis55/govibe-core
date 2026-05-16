import { randomUUID } from 'node:crypto';
import {
  AdmissionState,
  EventStatus,
  OrderStatus,
  OrganizerStatus,
  PaymentStatus,
  ReservationStatus,
  TicketStatus,
} from '@prisma/client';
import { PrismaService } from '../../src/shared/prisma/prisma.service';

export async function seedEventInventory(
  prisma: PrismaService,
  overrides?: Partial<{
    userId: string;
    userEmail: string;
    organizerId: string;
    venueId: string;
    eventId: string;
    ticketTypeId: string;
    inventoryId: string;
    gateId: string;
  }>,
): Promise<{
  userId: string;
  venueId: string;
  eventId: string;
  ticketTypeId: string;
  inventoryId: string;
  gateId: string;
}> {
  const userId = overrides?.userId ?? randomUUID();
  const organizerId = overrides?.organizerId ?? userId;
  const venueId = overrides?.venueId ?? randomUUID();
  const eventId = overrides?.eventId ?? randomUUID();
  const ticketTypeId = overrides?.ticketTypeId ?? randomUUID();
  const inventoryId = overrides?.inventoryId ?? randomUUID();
  const gateId = overrides?.gateId ?? randomUUID();

  await prisma.user.create({
    data: {
      id: userId,
      email: overrides?.userEmail ?? `buyer-${userId}@example.com`,
      passwordHash:
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  });
  await prisma.organizer.create({
    data: {
      id: organizerId,
      ownerUserId: userId,
      displayName: 'Test Organizer',
      slug: `organizer-${organizerId.slice(0, 8)}`,
      status: OrganizerStatus.APPROVED,
    },
  });
  await prisma.venue.create({ data: { id: venueId } });
  await prisma.event.create({
    data: {
      id: eventId,
      organizerId,
      title: 'Test Event',
      slug: `event-${eventId.slice(0, 8)}`,
      venueId,
      startsAt: new Date('2026-06-01T20:00:00.000Z'),
      endsAt: new Date('2026-06-01T23:30:00.000Z'),
      capacityTotal: 100,
      status: EventStatus.PUBLISHED,
      paymentEnabled: true,
      priceMinor: 5000,
      priceCurrency: 'GHS',
      venueName: 'Accra Hall',
      city: 'Accra',
      country: 'Ghana',
    },
  });
  await prisma.ticketType.create({
    data: {
      id: ticketTypeId,
      eventId,
      name: 'General Admission',
    },
  });
  await prisma.eventTicketInventory.create({
    data: {
      id: inventoryId,
      eventId,
      ticketTypeId,
      capacityTotal: 100,
      reservedCount: 0,
      soldCount: 0,
    },
  });
  await prisma.gate.create({
    data: {
      id: gateId,
      venueId,
      label: 'North Gate',
    },
  });

  return {
    userId,
    venueId,
    eventId,
    ticketTypeId,
    inventoryId,
    gateId,
  };
}

export async function seedPaidOrder(prisma: PrismaService, input: {
  userId: string;
  eventId: string;
  ticketTypeId: string;
  reservationQuantity?: number;
  amountMinor?: bigint;
  currency?: string;
}): Promise<{
  reservationId: string;
  orderId: string;
  paymentId: string;
}> {
  const reservationId = randomUUID();
  const orderId = randomUUID();
  const paymentId = randomUUID();
  const quantity = input.reservationQuantity ?? 2;
  const amount = input.amountMinor ?? BigInt(5000);
  const currency = input.currency ?? 'GHS';

  await prisma.ticketReservation.create({
    data: {
      id: reservationId,
      ownerUserId: input.userId,
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      quantity,
      status: ReservationStatus.HELD,
      expiresAt: new Date(Date.now() + 300_000),
    },
  });

  await prisma.order.create({
    data: {
      id: orderId,
      userId: input.userId,
      eventId: input.eventId,
      reservationId,
      status: OrderStatus.PAID,
      totalAmount: amount,
      currency,
    },
  });

  await prisma.payment.create({
    data: {
      id: paymentId,
      orderId,
      provider: 'paystack',
      providerRef: `provider-${paymentId}`,
      status: PaymentStatus.SUCCESS,
      amount,
    },
  });

  return {
    reservationId,
    orderId,
    paymentId,
  };
}

export async function seedTicketAdmission(prisma: PrismaService, input: {
  userId: string;
  eventId: string;
  ticketTypeId: string;
  orderId?: string | null;
  state?: AdmissionState;
}): Promise<{
  ticketId: string;
}> {
  const ticketId = randomUUID();

  await prisma.ticket.create({
    data: {
      id: ticketId,
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      ownerUserId: input.userId,
      orderId: input.orderId ?? null,
      status: TicketStatus.ACTIVE,
      ticketSerial: `SER-${ticketId.slice(0, 8)}`,
      publicReference: `GV-${ticketId.slice(0, 8)}`,
    },
  });

  await prisma.ticketAdmissionState.create({
    data: {
      ticketId,
      currentState: input.state ?? AdmissionState.NOT_USED,
      admissionCycleNo: input.state === AdmissionState.INSIDE ? 1 : 0,
      version: 1,
    },
  });

  return { ticketId };
}