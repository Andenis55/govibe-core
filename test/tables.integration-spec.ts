import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  EventTableStatus,
  EventVisibility,
  OrganizerStatus,
  TableAuditEvent,
  TableReservationStatus,
  VenueTableStatus,
} from '@prisma/client';
import request = require('supertest');
import { TableAuditService } from '../src/modules/tables/application/table-audit.service';
import {
  ContainerRuntimeUnavailableError,
  createOperationalRuntime,
  OperationalRuntime,
} from './setup/operational-runtime';

describe('Tables integration', () => {
  let runtime: OperationalRuntime | null = null;

  beforeAll(async () => {
    try {
      runtime = await createOperationalRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }
  });

  afterEach(async () => {
    delete process.env.TABLE_HOLD_DURATION_SECONDS;

    if (runtime) {
      jest.restoreAllMocks();
      await runtime.reset();
    }
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  async function signupAndLoginCustomer(
    email: string,
    deviceId = 'device-a',
  ): Promise<request.Response> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    await request(runtime.app.getHttpServer())
      .post('/auth/signup')
      .send({
        email,
        password: 'Password1',
        deviceId,
      })
      .expect(201);

    return request(runtime.app.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password: 'Password1',
        deviceId,
      })
      .expect(201);
  }

  async function createOrganizer(
    accessToken: string,
    slug: string,
  ): Promise<Record<string, unknown>> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    const response = await request(runtime.app.getHttpServer())
      .post('/organizers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        displayName: `Organizer ${slug}`,
        slug,
        description: 'Tables test organizer',
        contactEmail: `${slug}@govibe.test`,
      })
      .expect(201);

    return response.body as Record<string, unknown>;
  }

  async function approveOrganizer(organizerId: string): Promise<void> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    await runtime.prisma.organizer.update({
      where: { id: organizerId },
      data: { status: OrganizerStatus.APPROVED },
    });
  }

  async function createEvent(
    accessToken: string,
    organizerId: string,
    slug: string,
    overrides?: Partial<{
      title: string;
      visibility: EventVisibility;
      startsAt: string;
      endsAt: string;
      venueName: string;
      city: string;
      country: string;
      capacityTotal: number;
    }>,
  ): Promise<Record<string, unknown>> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    const response = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizerId}/events`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: overrides?.title ?? `Event ${slug}`,
        slug,
        visibility: overrides?.visibility ?? EventVisibility.PUBLIC,
        startsAt: overrides?.startsAt ?? '2027-01-01T20:00:00.000Z',
        endsAt: overrides?.endsAt ?? '2027-01-02T01:00:00.000Z',
        venueName: overrides?.venueName ?? 'Accra Hall',
        city: overrides?.city ?? 'Accra',
        country: overrides?.country ?? 'Ghana',
        capacityTotal: overrides?.capacityTotal ?? 500,
      })
      .expect(201);

    return response.body as Record<string, unknown>;
  }

  async function publishEvent(
    accessToken: string,
    eventId: string,
  ): Promise<Record<string, unknown>> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    const response = await request(runtime.app.getHttpServer())
      .post(`/events/${eventId}/publish`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    return response.body as Record<string, unknown>;
  }

  async function createFloorSection(
    accessToken: string,
    organizerId: string,
    name: string,
  ): Promise<Record<string, unknown>> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    const response = await request(runtime.app.getHttpServer())
      .post('/tables/floor-sections')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        organizerId,
        name,
        description: `${name} description`,
      })
      .expect(201);

    return response.body as Record<string, unknown>;
  }

  async function createVenueTable(
    accessToken: string,
    input: {
      organizerId: string;
      floorSectionId?: string;
      label: string;
      seatCount: number;
      status?: VenueTableStatus;
    },
    expectedStatus = 201,
  ): Promise<request.Response> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    return request(runtime.app.getHttpServer())
      .post('/tables/venue-tables')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input)
      .expect(expectedStatus);
  }

  async function createEventTable(
    accessToken: string,
    input: {
      organizerId: string;
      eventId: string;
      venueTableId: string;
      priceMinor: number;
      currency: string;
      status?: EventTableStatus;
    },
    expectedStatus = 201,
  ): Promise<request.Response> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    return request(runtime.app.getHttpServer())
      .post('/tables/event-tables')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input)
      .expect(expectedStatus);
  }

  async function holdTable(
    accessToken: string,
    eventId: string,
    input: {
      eventTableId: string;
      idempotencyKey: string;
      holdDurationSeconds?: number;
    },
    expectedStatus = 201,
  ): Promise<request.Response> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    return request(runtime.app.getHttpServer())
      .post(`/tables/events/${eventId}/hold`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(input)
      .expect(expectedStatus);
  }

  async function createPublishedSetup(input: {
    accessToken: string;
    slug: string;
    visibility?: EventVisibility;
    venueTableStatus?: VenueTableStatus;
    eventTableStatus?: EventTableStatus;
    endsAt?: string;
  }): Promise<{
    organizer: Record<string, unknown>;
    event: Record<string, unknown>;
    floorSection: Record<string, unknown>;
    venueTable: Record<string, unknown>;
    eventTable: Record<string, unknown>;
  }> {
    const organizer = await createOrganizer(input.accessToken, `${input.slug}-org`);
    await approveOrganizer(organizer.id as string);

    const event = await createEvent(
      input.accessToken,
      organizer.id as string,
      `${input.slug}-event`,
      {
        visibility: input.visibility ?? EventVisibility.PUBLIC,
        endsAt: input.endsAt,
      },
    );
    await publishEvent(input.accessToken, event.id as string);

    const floorSection = await createFloorSection(
      input.accessToken,
      organizer.id as string,
      `${input.slug}-floor`,
    );
    const venueTable = await createVenueTable(input.accessToken, {
      organizerId: organizer.id as string,
      floorSectionId: floorSection.id as string,
      label: `${input.slug}-table-a`,
      seatCount: 6,
      status: input.venueTableStatus,
    });
    const eventTable = await createEventTable(input.accessToken, {
      organizerId: organizer.id as string,
      eventId: event.id as string,
      venueTableId: venueTable.body.id as string,
      priceMinor: 150000,
      currency: 'GHS',
      status: input.eventTableStatus,
    });

    return {
      organizer,
      event,
      floorSection,
      venueTable: venueTable.body as Record<string, unknown>,
      eventTable: eventTable.body as Record<string, unknown>,
    };
  }

  function readTablesModuleSource(): string {
    const root = join(process.cwd(), 'src', 'modules', 'tables');
    const files = walkFiles(root);
    return files.map((filePath) => readFileSync(filePath, 'utf8')).join('\n');
  }

  function walkFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const fullPath = join(directory, entry);
      const stats = statSync(fullPath);

      if (stats.isDirectory()) {
        return walkFiles(fullPath);
      }

      return fullPath;
    });
  }

  async function expectAvailabilityAndHoldBlocked(
    accessToken: string,
    eventId: string,
    eventTableId: string,
  ): Promise<void> {
    if (!runtime) {
      throw new Error('Runtime unavailable');
    }

    await request(runtime.app.getHttpServer())
      .get(`/tables/events/${eventId}/availability`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    await holdTable(
      accessToken,
      eventId,
      {
        eventTableId,
        idempotencyKey: `blocked-${eventId}`,
      },
      403,
    );
  }

  it('keeps WS10 schema and source boundaries closed', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
    const tableSchema = [
      schema.match(/enum EventTableStatus\s*\{[\s\S]*?\}/)?.[0] ?? '',
      schema.match(/enum TableReservationStatus\s*\{[\s\S]*?\}/)?.[0] ?? '',
      schema.match(/enum TableAuditEvent\s*\{[\s\S]*?\}/)?.[0] ?? '',
      schema.match(/model TableReservation\s*\{[\s\S]*?\}/)?.[0] ?? '',
    ].join('\n');
    const source = readTablesModuleSource();

    expect(tableSchema).not.toContain('CONFIRMED');
    expect(tableSchema).not.toContain('RESERVED');
    expect(tableSchema).not.toContain('paymentIntentId');
    expect(tableSchema).not.toContain('TABLE_RESERVATION_CONFIRMED');

    expect(source).not.toContain('paymentIntentId');
    expect(source).not.toContain('TABLE_RESERVATION_CONFIRMED');
    expect(source).not.toMatch(/modules\/payments|payments\.service|payment-verification/i);
    expect(source).not.toMatch(/modules\/tickets|tickets\.service|issue-tickets/i);
    expect(source).not.toMatch(/modules\/admissions|admissions\.service/i);
  });

  it('supports organizer table setup with ownership, uniqueness, and validation', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-owner@govibe.test');
    const attacker = await signupAndLoginCustomer('tables-attacker@govibe.test');
    const organizer = await createOrganizer(
      owner.body.tokens.accessToken as string,
      'tables-owner-org',
    );
    await approveOrganizer(organizer.id as string);

    const floorSection = await createFloorSection(
      owner.body.tokens.accessToken as string,
      organizer.id as string,
      'Main Floor',
    );

    expect(floorSection.name).toBe('Main Floor');

    const venueTable = await createVenueTable(owner.body.tokens.accessToken as string, {
      organizerId: organizer.id as string,
      floorSectionId: floorSection.id as string,
      label: 'VIP-1',
      seatCount: 6,
    });

    expect(venueTable.body.label).toBe('VIP-1');
    expect(venueTable.body.floorSectionName).toBe('Main Floor');

    await createVenueTable(
      owner.body.tokens.accessToken as string,
      {
        organizerId: organizer.id as string,
        label: 'VIP-1',
        seatCount: 6,
      },
      409,
    );

    await createVenueTable(
      owner.body.tokens.accessToken as string,
      {
        organizerId: organizer.id as string,
        label: 'BAD-SEAT',
        seatCount: 0,
      },
      400,
    );

    await createVenueTable(
      attacker.body.tokens.accessToken as string,
      {
        organizerId: organizer.id as string,
        label: 'ATTACK',
        seatCount: 4,
      },
      404,
    );
  });

  it('enforces event table ownership and duplicate constraints', async () => {
    if (!runtime) {
      return;
    }

    const first = await signupAndLoginCustomer('tables-event-owner@govibe.test');
    const second = await signupAndLoginCustomer('tables-event-other@govibe.test');
    const firstSetup = await createPublishedSetup({
      accessToken: first.body.tokens.accessToken as string,
      slug: 'ownership-a',
    });
    const secondSetup = await createPublishedSetup({
      accessToken: second.body.tokens.accessToken as string,
      slug: 'ownership-b',
    });

    await createEventTable(
      first.body.tokens.accessToken as string,
      {
        organizerId: firstSetup.organizer.id as string,
        eventId: firstSetup.event.id as string,
        venueTableId: firstSetup.venueTable.id as string,
        priceMinor: 120000,
        currency: 'GHS',
      },
      409,
    );

    await createEventTable(
      first.body.tokens.accessToken as string,
      {
        organizerId: firstSetup.organizer.id as string,
        eventId: secondSetup.event.id as string,
        venueTableId: firstSetup.venueTable.id as string,
        priceMinor: 120000,
        currency: 'GHS',
      },
      404,
    );

    await createEventTable(
      first.body.tokens.accessToken as string,
      {
        organizerId: firstSetup.organizer.id as string,
        eventId: firstSetup.event.id as string,
        venueTableId: secondSetup.venueTable.id as string,
        priceMinor: 120000,
        currency: 'GHS',
      },
      409,
    );
  });

  it('allows organizer to patch event table status without using HELD as an input status', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-status-owner@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'status-update',
    });

    const toUnavailable = await request(runtime.app.getHttpServer())
      .patch(`/tables/event-tables/${setup.eventTable.id as string}/status`)
      .set('Authorization', `Bearer ${owner.body.tokens.accessToken}`)
      .send({ status: EventTableStatus.UNAVAILABLE })
      .expect(200);

    expect(toUnavailable.body.status).toBe('UNAVAILABLE');

    const toAvailable = await request(runtime.app.getHttpServer())
      .patch(`/tables/event-tables/${setup.eventTable.id as string}/status`)
      .set('Authorization', `Bearer ${owner.body.tokens.accessToken}`)
      .send({ status: EventTableStatus.AVAILABLE })
      .expect(200);

    expect(toAvailable.body.status).toBe('AVAILABLE');

    await request(runtime.app.getHttpServer())
      .patch(`/tables/event-tables/${setup.eventTable.id as string}/status`)
      .set('Authorization', `Bearer ${owner.body.tokens.accessToken}`)
      .send({ status: EventTableStatus.HELD })
      .expect(400);
  });

  it('returns safe availability fields and marks active holds as held', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-availability-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-availability-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'availability-main',
    });

    const secondVenueTable = await createVenueTable(owner.body.tokens.accessToken as string, {
      organizerId: setup.organizer.id as string,
      floorSectionId: setup.floorSection.id as string,
      label: 'availability-table-b',
      seatCount: 4,
    });
    await createEventTable(owner.body.tokens.accessToken as string, {
      organizerId: setup.organizer.id as string,
      eventId: setup.event.id as string,
      venueTableId: secondVenueTable.body.id as string,
      priceMinor: 90000,
      currency: 'GHS',
    });

    await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'availability-held',
    });

    const response = await request(runtime.app.getHttpServer())
      .get(`/tables/events/${setup.event.id as string}/availability`)
      .set('Authorization', `Bearer ${customer.body.tokens.accessToken}`)
      .expect(200);

    const held = (response.body as Array<Record<string, unknown>>).find(
      (item) => item.eventTableId === setup.eventTable.id,
    );
    const available = (response.body as Array<Record<string, unknown>>).find(
      (item) => item.eventTableId !== setup.eventTable.id,
    );

    expect(held?.availabilityStatus).toBe('HELD');
    expect(available?.availabilityStatus).toBe('AVAILABLE');
    expect(available?.floorSectionName).toBe('availability-main-floor');
    expect(available).not.toHaveProperty('description');
    expect(available).not.toHaveProperty('reservationId');
    expect(available).not.toHaveProperty('actorUserId');
    expect(available).not.toHaveProperty('holdExpiresAt');
  });

  it('blocks availability and holds for ineligible events and organizers', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-eligibility-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-eligibility-customer@govibe.test');

    const draftOrganizer = await createOrganizer(
      owner.body.tokens.accessToken as string,
      'eligibility-draft-org',
    );
    await approveOrganizer(draftOrganizer.id as string);
    const draftEvent = await createEvent(
      owner.body.tokens.accessToken as string,
      draftOrganizer.id as string,
      'eligibility-draft-event',
      { visibility: EventVisibility.PUBLIC },
    );
    const draftFloor = await createFloorSection(
      owner.body.tokens.accessToken as string,
      draftOrganizer.id as string,
      'draft-floor',
    );
    const draftVenue = await createVenueTable(owner.body.tokens.accessToken as string, {
      organizerId: draftOrganizer.id as string,
      floorSectionId: draftFloor.id as string,
      label: 'draft-table',
      seatCount: 4,
    });
    const draftEventTable = await createEventTable(owner.body.tokens.accessToken as string, {
      organizerId: draftOrganizer.id as string,
      eventId: draftEvent.id as string,
      venueTableId: draftVenue.body.id as string,
      priceMinor: 50000,
      currency: 'GHS',
    });

    await expectAvailabilityAndHoldBlocked(
      customer.body.tokens.accessToken as string,
      draftEvent.id as string,
      draftEventTable.body.id as string,
    );

    const privateSetup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'eligibility-private',
      visibility: EventVisibility.PRIVATE,
    });
    await expectAvailabilityAndHoldBlocked(
      customer.body.tokens.accessToken as string,
      privateSetup.event.id as string,
      privateSetup.eventTable.id as string,
    );

    const endedSetup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'eligibility-ended',
      endsAt: '2024-01-01T01:00:00.000Z',
    });
    await expectAvailabilityAndHoldBlocked(
      customer.body.tokens.accessToken as string,
      endedSetup.event.id as string,
      endedSetup.eventTable.id as string,
    );

    const suspendedSetup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'eligibility-suspended',
    });
    await runtime.prisma.organizer.update({
      where: { id: suspendedSetup.organizer.id as string },
      data: { status: OrganizerStatus.SUSPENDED },
    });
    await expectAvailabilityAndHoldBlocked(
      customer.body.tokens.accessToken as string,
      suspendedSetup.event.id as string,
      suspendedSetup.eventTable.id as string,
    );
  });

  it('creates held reservations with audit and enforces reservation ownership', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-hold-owner@govibe.test');
    const customerA = await signupAndLoginCustomer('tables-hold-a@govibe.test');
    const customerB = await signupAndLoginCustomer('tables-hold-b@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'hold-create',
    });

    const hold = await holdTable(customerA.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'hold-create-key',
    });

    expect(hold.body.status).toBe('HELD');
    expect(hold.body.eventTableId).toBe(setup.eventTable.id);
    expect(hold.body.label).toBe('hold-create-table-a');
    expect(hold.body).not.toHaveProperty('actorUserId');
    expect(hold.body).not.toHaveProperty('idempotencyKeyHash');
    expect(hold.body).not.toHaveProperty('requestFingerprintHash');

    const storedEventTable = await runtime.prisma.eventTable.findUniqueOrThrow({
      where: { id: setup.eventTable.id as string },
    });
    expect(storedEventTable.status).toBe(EventTableStatus.HELD);

    const audits = await runtime.prisma.tableAuditLog.findMany({
      where: {
        reservationId: hold.body.id as string,
        event: TableAuditEvent.TABLE_HOLD_CREATED,
      },
    });
    expect(audits).toHaveLength(1);

    const ownRead = await request(runtime.app.getHttpServer())
      .get(`/tables/reservations/${hold.body.id as string}`)
      .set('Authorization', `Bearer ${customerA.body.tokens.accessToken}`)
      .expect(200);
    expect(ownRead.body.id).toBe(hold.body.id);

    await request(runtime.app.getHttpServer())
      .get(`/tables/reservations/${hold.body.id as string}`)
      .set('Authorization', `Bearer ${customerB.body.tokens.accessToken}`)
      .expect(404);
  });

  it('returns the original reservation for same-actor same-key same-fingerprint replay', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-idem-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-idem-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'idem-replay',
    });

    const first = await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'idem-replay-key',
    });
    const second = await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'idem-replay-key',
    });

    expect(second.body.id).toBe(first.body.id);

    const reservations = await runtime.prisma.tableReservation.findMany({
      where: { actorUserId: customer.body.user.id as string },
    });
    expect(reservations).toHaveLength(1);
  });

  it('rejects same-actor same-key replay with a different request fingerprint', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-idem-conflict-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-idem-conflict-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'idem-conflict',
    });
    const secondVenueTable = await createVenueTable(owner.body.tokens.accessToken as string, {
      organizerId: setup.organizer.id as string,
      floorSectionId: setup.floorSection.id as string,
      label: 'idem-conflict-table-b',
      seatCount: 4,
    });
    const secondEventTable = await createEventTable(owner.body.tokens.accessToken as string, {
      organizerId: setup.organizer.id as string,
      eventId: setup.event.id as string,
      venueTableId: secondVenueTable.body.id as string,
      priceMinor: 75000,
      currency: 'GHS',
    });

    await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'idem-conflict-key',
    });

    await holdTable(
      customer.body.tokens.accessToken as string,
      setup.event.id as string,
      {
        eventTableId: secondEventTable.body.id as string,
        idempotencyKey: 'idem-conflict-key',
      },
      409,
    );
  });

  it('scopes idempotency by actor so different users can reuse the same key without collision', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-idem-scope-owner@govibe.test');
    const customerA = await signupAndLoginCustomer('tables-idem-scope-a@govibe.test');
    const customerB = await signupAndLoginCustomer('tables-idem-scope-b@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'idem-scope',
    });
    const secondVenueTable = await createVenueTable(owner.body.tokens.accessToken as string, {
      organizerId: setup.organizer.id as string,
      floorSectionId: setup.floorSection.id as string,
      label: 'idem-scope-table-b',
      seatCount: 4,
    });
    const secondEventTable = await createEventTable(owner.body.tokens.accessToken as string, {
      organizerId: setup.organizer.id as string,
      eventId: setup.event.id as string,
      venueTableId: secondVenueTable.body.id as string,
      priceMinor: 70000,
      currency: 'GHS',
    });

    const first = await holdTable(customerA.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'shared-key',
    });
    const second = await holdTable(customerB.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: secondEventTable.body.id as string,
      idempotencyKey: 'shared-key',
    });

    expect(first.body.id).not.toBe(second.body.id);
  });

  it('returns the original expired reservation on same-key replay after expiry', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-idem-expiry-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-idem-expiry-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'idem-expiry',
    });

    const first = await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'idem-expired-key',
    });

    const expiredAt = new Date('2026-01-01T00:00:00.000Z');
    await runtime.prisma.tableReservation.update({
      where: { id: first.body.id as string },
      data: { holdExpiresAt: expiredAt },
    });
    await runtime.prisma.eventTable.update({
      where: { id: setup.eventTable.id as string },
      data: {
        status: EventTableStatus.HELD,
        holdExpiresAt: expiredAt,
      },
    });

    const replay = await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'idem-expired-key',
    });

    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.status).toBe('EXPIRED');

    const reservations = await runtime.prisma.tableReservation.findMany({
      where: { actorUserId: customer.body.user.id as string },
    });
    expect(reservations).toHaveLength(1);
  });

  it('releases expired holds during availability reads and records the required audit metadata', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-expire-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-expire-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'expire-availability',
    });

    const hold = await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'expire-availability-key',
    });

    const expiredAt = new Date('2026-01-01T00:00:00.000Z');
    await runtime.prisma.tableReservation.update({
      where: { id: hold.body.id as string },
      data: { holdExpiresAt: expiredAt },
    });
    await runtime.prisma.eventTable.update({
      where: { id: setup.eventTable.id as string },
      data: {
        status: EventTableStatus.HELD,
        holdExpiresAt: expiredAt,
      },
    });

    const availability = await request(runtime.app.getHttpServer())
      .get(`/tables/events/${setup.event.id as string}/availability`)
      .set('Authorization', `Bearer ${customer.body.tokens.accessToken}`)
      .expect(200);

    const item = (availability.body as Array<Record<string, unknown>>).find(
      (entry) => entry.eventTableId === setup.eventTable.id,
    );
    expect(item?.availabilityStatus).toBe('AVAILABLE');

    const reservation = await runtime.prisma.tableReservation.findUniqueOrThrow({
      where: { id: hold.body.id as string },
    });
    expect(reservation.status).toBe(TableReservationStatus.EXPIRED);

    const eventTable = await runtime.prisma.eventTable.findUniqueOrThrow({
      where: { id: setup.eventTable.id as string },
    });
    expect(eventTable.status).toBe(EventTableStatus.AVAILABLE);
    expect(eventTable.holdExpiresAt).toBeNull();

    const audit = await runtime.prisma.tableAuditLog.findFirstOrThrow({
      where: {
        reservationId: hold.body.id as string,
        event: TableAuditEvent.TABLE_HOLD_EXPIRED,
      },
    });
    const metadata = audit.metadata as Record<string, unknown>;

    expect(audit.reason).toBe('hold_expired');
    expect(metadata.reservationId).toBe(hold.body.id);
    expect(metadata.eventTableId).toBe(setup.eventTable.id);
    expect(metadata.eventId).toBe(setup.event.id);
    expect(metadata.organizerId).toBe(setup.organizer.id);
    expect(metadata.reason).toBe('hold_expired');
  });

  it('expires only the requested reservation and table during reservation-owner reads', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-owner-read-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-owner-read-customer@govibe.test');
    const setupA = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'owner-read-a',
    });
    const setupB = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'owner-read-b',
    });

    const holdA = await holdTable(customer.body.tokens.accessToken as string, setupA.event.id as string, {
      eventTableId: setupA.eventTable.id as string,
      idempotencyKey: 'owner-read-a',
    });
    const holdB = await holdTable(customer.body.tokens.accessToken as string, setupB.event.id as string, {
      eventTableId: setupB.eventTable.id as string,
      idempotencyKey: 'owner-read-b',
    });

    const expiredAt = new Date('2026-01-01T00:00:00.000Z');
    await runtime.prisma.tableReservation.update({
      where: { id: holdA.body.id as string },
      data: { holdExpiresAt: expiredAt },
    });
    await runtime.prisma.eventTable.update({
      where: { id: setupA.eventTable.id as string },
      data: {
        status: EventTableStatus.HELD,
        holdExpiresAt: expiredAt,
      },
    });

    const ownRead = await request(runtime.app.getHttpServer())
      .get(`/tables/reservations/${holdA.body.id as string}`)
      .set('Authorization', `Bearer ${customer.body.tokens.accessToken}`)
      .expect(200);

    expect(ownRead.body.status).toBe('EXPIRED');

    const untouched = await runtime.prisma.tableReservation.findUniqueOrThrow({
      where: { id: holdB.body.id as string },
    });
    expect(untouched.status).toBe(TableReservationStatus.HELD);
  });

  it('bounds availability lazy expiration to the requested event scope', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-bounded-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-bounded-customer@govibe.test');
    const setupA = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'bounded-a',
    });
    const setupB = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'bounded-b',
    });

    const holdA = await holdTable(customer.body.tokens.accessToken as string, setupA.event.id as string, {
      eventTableId: setupA.eventTable.id as string,
      idempotencyKey: 'bounded-a',
    });
    const holdB = await holdTable(customer.body.tokens.accessToken as string, setupB.event.id as string, {
      eventTableId: setupB.eventTable.id as string,
      idempotencyKey: 'bounded-b',
    });

    const expiredAt = new Date('2026-01-01T00:00:00.000Z');
    await runtime.prisma.tableReservation.updateMany({
      where: {
        id: {
          in: [holdA.body.id as string, holdB.body.id as string],
        },
      },
      data: { holdExpiresAt: expiredAt },
    });
    await runtime.prisma.eventTable.updateMany({
      where: {
        id: {
          in: [setupA.eventTable.id as string, setupB.eventTable.id as string],
        },
      },
      data: {
        status: EventTableStatus.HELD,
        holdExpiresAt: expiredAt,
      },
    });

    await request(runtime.app.getHttpServer())
      .get(`/tables/events/${setupA.event.id as string}/availability`)
      .set('Authorization', `Bearer ${customer.body.tokens.accessToken}`)
      .expect(200);

    const expiredReservation = await runtime.prisma.tableReservation.findUniqueOrThrow({
      where: { id: holdA.body.id as string },
    });
    const untouchedReservation = await runtime.prisma.tableReservation.findUniqueOrThrow({
      where: { id: holdB.body.id as string },
    });

    expect(expiredReservation.status).toBe(TableReservationStatus.EXPIRED);
    expect(untouchedReservation.status).toBe(TableReservationStatus.HELD);
  });

  it('uses server-controlled hold duration and ignores client-provided duration', async () => {
    if (!runtime) {
      return;
    }

    process.env.TABLE_HOLD_DURATION_SECONDS = '90';

    const owner = await signupAndLoginCustomer('tables-duration-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-duration-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'duration-ignore',
    });

    const startedAt = Date.now();
    const hold = await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'duration-ignore-key',
      holdDurationSeconds: 1,
    });
    const remainingMs = new Date(hold.body.holdExpiresAt as string).getTime() - startedAt;

    expect(remainingMs).toBeGreaterThanOrEqual(80_000);
  });

  it('falls back to the default hold duration when TABLE_HOLD_DURATION_SECONDS is invalid', async () => {
    if (!runtime) {
      return;
    }

    process.env.TABLE_HOLD_DURATION_SECONDS = 'invalid';

    const owner = await signupAndLoginCustomer('tables-duration-fallback-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-duration-fallback-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'duration-fallback',
    });

    const startedAt = Date.now();
    const hold = await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'duration-fallback-key',
    });
    const remainingMs = new Date(hold.body.holdExpiresAt as string).getTime() - startedAt;

    expect(remainingMs).toBeGreaterThanOrEqual(590_000);
  });

  it('prevents oversell under concurrency and records only one successful hold audit', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-concurrency-owner@govibe.test');
    const customerA = await signupAndLoginCustomer('tables-concurrency-a@govibe.test');
    const customerB = await signupAndLoginCustomer('tables-concurrency-b@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'concurrency',
    });

    const [first, second] = await Promise.allSettled([
      holdTable(customerA.body.tokens.accessToken as string, setup.event.id as string, {
        eventTableId: setup.eventTable.id as string,
        idempotencyKey: 'concurrency-a',
      }),
      holdTable(customerB.body.tokens.accessToken as string, setup.event.id as string, {
        eventTableId: setup.eventTable.id as string,
        idempotencyKey: 'concurrency-b',
      }, 409),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('fulfilled');

    const activeReservations = await runtime.prisma.tableReservation.findMany({
      where: {
        eventTableId: setup.eventTable.id as string,
        status: TableReservationStatus.HELD,
      },
    });
    expect(activeReservations).toHaveLength(1);

    const storedEventTable = await runtime.prisma.eventTable.findUniqueOrThrow({
      where: { id: setup.eventTable.id as string },
    });
    expect(storedEventTable.status).toBe(EventTableStatus.HELD);

    const successAudits = await runtime.prisma.tableAuditLog.findMany({
      where: {
        eventTableId: setup.eventTable.id as string,
        event: TableAuditEvent.TABLE_HOLD_CREATED,
      },
    });
    expect(successAudits).toHaveLength(1);
  });

  it('fails closed when hold audit persistence fails', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-audit-fail-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-audit-fail-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'audit-fail-hold',
    });
    const auditService = runtime.app.get(TableAuditService);
    jest.spyOn(auditService, 'append').mockRejectedValueOnce(new Error('audit unavailable'));

    await holdTable(
      customer.body.tokens.accessToken as string,
      setup.event.id as string,
      {
        eventTableId: setup.eventTable.id as string,
        idempotencyKey: 'audit-fail-key',
      },
      500,
    );

    const reservations = await runtime.prisma.tableReservation.findMany({
      where: { eventTableId: setup.eventTable.id as string },
    });
    expect(reservations).toHaveLength(0);

    const storedEventTable = await runtime.prisma.eventTable.findUniqueOrThrow({
      where: { id: setup.eventTable.id as string },
    });
    expect(storedEventTable.status).toBe(EventTableStatus.AVAILABLE);
  });

  it('fails closed when expiration audit persistence fails', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-expire-audit-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-expire-audit-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'expire-audit-fail',
    });
    const hold = await holdTable(customer.body.tokens.accessToken as string, setup.event.id as string, {
      eventTableId: setup.eventTable.id as string,
      idempotencyKey: 'expire-audit-fail-key',
    });

    const expiredAt = new Date('2026-01-01T00:00:00.000Z');
    await runtime.prisma.tableReservation.update({
      where: { id: hold.body.id as string },
      data: { holdExpiresAt: expiredAt },
    });
    await runtime.prisma.eventTable.update({
      where: { id: setup.eventTable.id as string },
      data: {
        status: EventTableStatus.HELD,
        holdExpiresAt: expiredAt,
      },
    });

    const auditService = runtime.app.get(TableAuditService);
    const originalAppend = auditService.append.bind(auditService);
    jest
      .spyOn(auditService, 'append')
      .mockImplementation(async (input, options) => {
        if (input.event === TableAuditEvent.TABLE_HOLD_EXPIRED) {
          throw new Error('audit unavailable');
        }

        return originalAppend(input, options);
      });

    await request(runtime.app.getHttpServer())
      .get(`/tables/events/${setup.event.id as string}/availability`)
      .set('Authorization', `Bearer ${customer.body.tokens.accessToken}`)
      .expect(500);

    const reservation = await runtime.prisma.tableReservation.findUniqueOrThrow({
      where: { id: hold.body.id as string },
    });
    const eventTable = await runtime.prisma.eventTable.findUniqueOrThrow({
      where: { id: setup.eventTable.id as string },
    });

    expect(reservation.status).toBe(TableReservationStatus.HELD);
    expect(eventTable.status).toBe(EventTableStatus.HELD);
  });

  it('corrects stale held cache state when no active hold exists', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('tables-cache-owner@govibe.test');
    const customer = await signupAndLoginCustomer('tables-cache-customer@govibe.test');
    const setup = await createPublishedSetup({
      accessToken: owner.body.tokens.accessToken as string,
      slug: 'cache-correction',
    });

    await runtime.prisma.eventTable.update({
      where: { id: setup.eventTable.id as string },
      data: {
        status: EventTableStatus.HELD,
        holdExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const availability = await request(runtime.app.getHttpServer())
      .get(`/tables/events/${setup.event.id as string}/availability`)
      .set('Authorization', `Bearer ${customer.body.tokens.accessToken}`)
      .expect(200);

    const item = (availability.body as Array<Record<string, unknown>>).find(
      (entry) => entry.eventTableId === setup.eventTable.id,
    );
    expect(item?.availabilityStatus).toBe('AVAILABLE');

    const eventTable = await runtime.prisma.eventTable.findUniqueOrThrow({
      where: { id: setup.eventTable.id as string },
    });
    expect(eventTable.status).toBe(EventTableStatus.AVAILABLE);
    expect(eventTable.holdExpiresAt).toBeNull();
  });
});