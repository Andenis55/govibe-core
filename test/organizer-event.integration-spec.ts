import { OrganizerStatus } from '@prisma/client';
import request = require('supertest');
import {
  ContainerRuntimeUnavailableError,
  createOperationalRuntime,
  OperationalRuntime,
} from './setup/operational-runtime';

describe('Organizer and event management integration', () => {
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
    if (runtime) {
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
        description: 'Test organizer',
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

  it('creates organizer as authenticated user', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('owner@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'owner-events',
    );

    expect(organizer.id).toBeDefined();
    expect(organizer.ownerUserId).toBe(login.body.user.id);
    expect(organizer.slug).toBe('owner-events');
    expect(organizer.status).toBe('DRAFT');
  });

  it('rejects unauthenticated organizer creation', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer())
      .post('/organizers')
      .send({
        displayName: 'No Auth Organizer',
        slug: 'no-auth-organizer',
      })
      .expect(401);
  });

  it('prevents duplicate organizer slug', async () => {
    if (!runtime) {
      return;
    }

    const first = await signupAndLoginCustomer('first@govibe.test');
    const second = await signupAndLoginCustomer('second@govibe.test');

    await createOrganizer(
      first.body.tokens.accessToken as string,
      'duplicate-org',
    );

    await request(runtime.app.getHttpServer())
      .post('/organizers')
      .set('Authorization', `Bearer ${second.body.tokens.accessToken}`)
      .send({
        displayName: 'Duplicate Org',
        slug: 'duplicate-org',
      })
      .expect(409);
  });

  it('allows owner to update own draft organizer', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('update-owner@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'update-org',
    );

    const response = await request(runtime.app.getHttpServer())
      .patch(`/organizers/${organizer.id as string}`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        displayName: 'Updated Organizer',
      })
      .expect(200);

    expect(response.body.displayName).toBe('Updated Organizer');
  });

  it('blocks non-owner from reading another organizer through owner endpoint', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('actual-owner@govibe.test');
    const attacker = await signupAndLoginCustomer('attacker@govibe.test');

    const organizer = await createOrganizer(
      owner.body.tokens.accessToken as string,
      'private-org',
    );

    await request(runtime.app.getHttpServer())
      .get(`/organizers/${organizer.id as string}`)
      .set('Authorization', `Bearer ${attacker.body.tokens.accessToken}`)
      .expect(404);
  });

  it('blocks non-owner from updating another organizer', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('owner-update@govibe.test');
    const attacker = await signupAndLoginCustomer('attacker-update@govibe.test');

    const organizer = await createOrganizer(
      owner.body.tokens.accessToken as string,
      'owner-update-org',
    );

    await request(runtime.app.getHttpServer())
      .patch(`/organizers/${organizer.id as string}`)
      .set('Authorization', `Bearer ${attacker.body.tokens.accessToken}`)
      .send({
        displayName: 'Hijacked Organizer',
      })
      .expect(404);
  });

  it('blocks updating suspended organizer', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('suspended-owner@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'suspended-org',
    );

    await runtime.prisma.organizer.update({
      where: { id: organizer.id as string },
      data: { status: OrganizerStatus.SUSPENDED },
    });

    await request(runtime.app.getHttpServer())
      .patch(`/organizers/${organizer.id as string}`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        displayName: 'Suspended Organizer',
      })
      .expect(403);
  });

  it('submits draft organizer to pending review', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('submit-owner@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'submit-org',
    );

    const response = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/submit`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        note: 'Ready for review',
      })
      .expect(201);

    expect(response.body.status).toBe('PENDING_REVIEW');
  });

  it('blocks submitting non-draft organizer twice', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('submit-twice@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'submit-twice-org',
    );

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/submit`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({})
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/submit`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({})
      .expect(400);
  });

  it('blocks event creation until organizer is approved', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('unapproved-event@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'unapproved-org',
    );

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'Blocked Event',
        slug: 'blocked-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
      })
      .expect(403);
  });

  it('rejects unauthenticated event creation', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('unauth-event@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'unauth-event-org',
    );
    await approveOrganizer(organizer.id as string);

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .send({
        title: 'No Auth Event',
        slug: 'no-auth-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
      })
      .expect(401);
  });

  it('creates draft event for approved owned organizer', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('event-owner@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'event-org',
    );
    await approveOrganizer(organizer.id as string);

    const response = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'Launch Night',
        slug: 'launch-night',
        description: 'Opening event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
        venueName: 'Accra Hall',
        city: 'Accra',
        country: 'Ghana',
        capacityTotal: 500,
      })
      .expect(201);

    expect(response.body.status).toBe('DRAFT');
    expect(response.body.slug).toBe('launch-night');
    expect(response.body.organizerId).toBe(organizer.id);
  });

  it('rejects invalid event date range', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('bad-date@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'bad-date-org',
    );
    await approveOrganizer(organizer.id as string);

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'Bad Date',
        slug: 'bad-date',
        startsAt: '2027-01-01T23:00:00.000Z',
        endsAt: '2027-01-01T20:00:00.000Z',
      })
      .expect(400);
  });

  it('blocks non-owner from creating event under another organizer', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('event-real-owner@govibe.test');
    const attacker = await signupAndLoginCustomer('event-attacker@govibe.test');

    const organizer = await createOrganizer(
      owner.body.tokens.accessToken as string,
      'owned-org',
    );
    await approveOrganizer(organizer.id as string);

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${attacker.body.tokens.accessToken}`)
      .send({
        title: 'Attack Event',
        slug: 'attack-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
      })
      .expect(404);
  });

  it('blocks non-owner from updating another event', async () => {
    if (!runtime) {
      return;
    }

    const owner = await signupAndLoginCustomer('event-update-owner@govibe.test');
    const attacker = await signupAndLoginCustomer('event-update-attacker@govibe.test');

    const organizer = await createOrganizer(
      owner.body.tokens.accessToken as string,
      'event-update-org',
    );
    await approveOrganizer(organizer.id as string);

    const created = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${owner.body.tokens.accessToken}`)
      .send({
        title: 'Owner Event',
        slug: 'owner-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
        venueName: 'Accra Hall',
        city: 'Accra',
        country: 'Ghana',
        capacityTotal: 100,
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .patch(`/events/${created.body.id as string}`)
      .set('Authorization', `Bearer ${attacker.body.tokens.accessToken}`)
      .send({
        title: 'Hijacked Event',
      })
      .expect(404);
  });

  it('prevents duplicate event slug under the same organizer', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('duplicate-event@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'duplicate-event-org',
    );
    await approveOrganizer(organizer.id as string);

    const payload = {
      title: 'Duplicate Event',
      slug: 'same-slug',
      startsAt: '2027-01-01T20:00:00.000Z',
      endsAt: '2027-01-01T23:00:00.000Z',
      venueName: 'Accra Hall',
      city: 'Accra',
      country: 'Ghana',
      capacityTotal: 100,
    };

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send(payload)
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        ...payload,
        title: 'Duplicate Event Again',
      })
      .expect(409);
  });

  it('allows the same event slug under different organizers', async () => {
    if (!runtime) {
      return;
    }

    const first = await signupAndLoginCustomer('first-slug@govibe.test');
    const second = await signupAndLoginCustomer('second-slug@govibe.test');

    const firstOrganizer = await createOrganizer(
      first.body.tokens.accessToken as string,
      'first-slug-org',
    );
    const secondOrganizer = await createOrganizer(
      second.body.tokens.accessToken as string,
      'second-slug-org',
    );
    await approveOrganizer(firstOrganizer.id as string);
    await approveOrganizer(secondOrganizer.id as string);

    const payload = {
      title: 'Shared Slug Event',
      slug: 'shared-slug',
      startsAt: '2027-01-01T20:00:00.000Z',
      endsAt: '2027-01-01T23:00:00.000Z',
      venueName: 'Accra Hall',
      city: 'Accra',
      country: 'Ghana',
      capacityTotal: 100,
    };

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${firstOrganizer.id as string}/events`)
      .set('Authorization', `Bearer ${first.body.tokens.accessToken}`)
      .send(payload)
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post(`/organizers/${secondOrganizer.id as string}/events`)
      .set('Authorization', `Bearer ${second.body.tokens.accessToken}`)
      .send(payload)
      .expect(201);
  });

  it('publishes draft event when publish requirements are satisfied', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('publish-owner@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'publish-org',
    );
    await approveOrganizer(organizer.id as string);

    const created = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'Publish Event',
        slug: 'publish-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
        venueName: 'Accra Hall',
        city: 'Accra',
        country: 'Ghana',
        capacityTotal: 500,
      })
      .expect(201);

    const published = await request(runtime.app.getHttpServer())
      .post(`/events/${created.body.id as string}/publish`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({})
      .expect(201);

    expect(published.body.status).toBe('PUBLISHED');
    expect(published.body.publishedAt).toBeDefined();
  });

  it('blocks publish when capacity is missing', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('publish-missing-cap@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'missing-cap-org',
    );
    await approveOrganizer(organizer.id as string);

    const created = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'No Capacity Event',
        slug: 'no-capacity-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
        venueName: 'Accra Hall',
        city: 'Accra',
        country: 'Ghana',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post(`/events/${created.body.id as string}/publish`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({})
      .expect(400);
  });

  it('blocks publish when location fields are missing', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('publish-missing-location@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'missing-location-org',
    );
    await approveOrganizer(organizer.id as string);

    const created = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'No Location Event',
        slug: 'no-location-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
        capacityTotal: 250,
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post(`/events/${created.body.id as string}/publish`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({})
      .expect(400);
  });

  it('blocks cancelling a draft event', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('draft-cancel@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'draft-cancel-org',
    );
    await approveOrganizer(organizer.id as string);

    const created = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'Draft Cancel Event',
        slug: 'draft-cancel-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
        venueName: 'Accra Hall',
        city: 'Accra',
        country: 'Ghana',
        capacityTotal: 100,
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post(`/events/${created.body.id as string}/cancel`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        reason: 'Not published yet',
      })
      .expect(400);
  });

  it('allows cancelling a published event', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('published-cancel@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'published-cancel-org',
    );
    await approveOrganizer(organizer.id as string);

    const created = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'Published Cancel Event',
        slug: 'published-cancel-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
        venueName: 'Accra Hall',
        city: 'Accra',
        country: 'Ghana',
        capacityTotal: 100,
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post(`/events/${created.body.id as string}/publish`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({})
      .expect(201);

    const cancelled = await request(runtime.app.getHttpServer())
      .post(`/events/${created.body.id as string}/cancel`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        reason: 'Venue unavailable',
      })
      .expect(201);

    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.cancelledAt).toBeDefined();
  });

  it('rejects lowering capacityTotal below capacityHeld', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('capacity-floor@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'capacity-floor-org',
    );
    await approveOrganizer(organizer.id as string);

    const created = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'Capacity Floor Event',
        slug: 'capacity-floor-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
        venueName: 'Accra Hall',
        city: 'Accra',
        country: 'Ghana',
        capacityTotal: 10,
      })
      .expect(201);

    await runtime.prisma.event.update({
      where: { id: created.body.id as string },
      data: { capacityHeld: 5 },
    });

    await request(runtime.app.getHttpServer())
      .patch(`/events/${created.body.id as string}`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        capacityTotal: 4,
      })
      .expect(400);
  });

  it('blocks updating cancelled event', async () => {
    if (!runtime) {
      return;
    }

    const login = await signupAndLoginCustomer('cancel-update@govibe.test');
    const organizer = await createOrganizer(
      login.body.tokens.accessToken as string,
      'cancel-update-org',
    );
    await approveOrganizer(organizer.id as string);

    const created = await request(runtime.app.getHttpServer())
      .post(`/organizers/${organizer.id as string}/events`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'Cancel Update Event',
        slug: 'cancel-update-event',
        startsAt: '2027-01-01T20:00:00.000Z',
        endsAt: '2027-01-01T23:00:00.000Z',
        venueName: 'Accra Hall',
        city: 'Accra',
        country: 'Ghana',
        capacityTotal: 500,
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post(`/events/${created.body.id as string}/publish`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({})
      .expect(201);

    await request(runtime.app.getHttpServer())
      .post(`/events/${created.body.id as string}/cancel`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        reason: 'Venue unavailable',
      })
      .expect(201);

    await request(runtime.app.getHttpServer())
      .patch(`/events/${created.body.id as string}`)
      .set('Authorization', `Bearer ${login.body.tokens.accessToken}`)
      .send({
        title: 'Should Not Update',
      })
      .expect(403);
  });
});