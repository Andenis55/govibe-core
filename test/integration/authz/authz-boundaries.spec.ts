import { createHmac } from 'node:crypto';
import request = require('supertest');
import {
  ContainerRuntimeUnavailableError,
  createOperationalRuntime,
  OperationalRuntime,
  TEST_AUTH_IDENTITIES,
} from '../../setup/operational-runtime';
import { seedEventInventory, seedTicketAdmission } from '../../setup/seed-data';
import { getTestGlobals } from '../../setup/test-globals';

describe('authorization boundaries', () => {
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

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  it('allows a gate agent with admissions:scan permission to validate a ticket', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedEventInventory(runtime.prisma);
    const ticket = await seedTicketAdmission(runtime.prisma, {
      userId: seeded.userId,
      eventId: seeded.eventId,
      ticketTypeId: seeded.ticketTypeId,
    });

    await runtime.prisma.user.create({
      data: {
        id: TEST_AUTH_IDENTITIES.gateAgent.userId,
        email: TEST_AUTH_IDENTITIES.gateAgent.email,
        passwordHash:
          '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
      },
    });

    getTestGlobals().__QR_VERIFIER__?.verify.mockResolvedValueOnce({
      ticketId: ticket.ticketId,
      eventId: seeded.eventId,
      nonce: 'nonce-authz-allowed',
      direction: 'ENTRY',
      sessionId: 'session-authz',
      expiresAt: new Date(Date.now() + 30000),
    });

    await request(runtime.app.getHttpServer())
      .post('/admissions/validate')
      .set('Authorization', `Bearer ${runtime.tokens.gateAgent}`)
      .send({
        rawToken: 'x'.repeat(40),
        gateId: seeded.gateId,
        scanEventId: '85000000-0000-4000-8000-000000000001',
      })
      .expect(201)
      .expect({
        ticketId: ticket.ticketId,
        accepted: true,
        currentState: 'INSIDE',
        result: 'ACCEPTED',
      });
  });

  it('denies an organizer lacking admissions:scan permission', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer())
      .post('/admissions/validate')
      .set('Authorization', `Bearer ${runtime.tokens.organizerNoScan}`)
      .send({
        rawToken: 'x'.repeat(40),
        gateId: '85000000-0000-4000-8000-000000000002',
        scanEventId: '85000000-0000-4000-8000-000000000003',
      })
      .expect(403);
  });

  it('denies a customer on the admissions permission boundary', async () => {
    if (!runtime) {
      return;
    }

    await request(runtime.app.getHttpServer())
      .post('/admissions/validate')
      .set('Authorization', `Bearer ${runtime.tokens.customer}`)
      .send({
        rawToken: 'x'.repeat(40),
        gateId: '85000000-0000-4000-8000-000000000004',
        scanEventId: '85000000-0000-4000-8000-000000000005',
      })
      .expect(403);
  });

  it('does not require JWT on the Paystack webhook route but still requires a valid signature', async () => {
    if (!runtime) {
      return;
    }

    const globals = getTestGlobals();

    jest
      .spyOn(globals.__PAYSTACK_PROVIDER__!, 'verifyPayment')
      .mockResolvedValueOnce({
        providerRef: 'sig-only-ref',
        status: 'SUCCESS',
        amountMinor: BigInt(12000),
        currency: 'GHS',
        raw: {},
      });

    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'sig-only-ref',
        status: 'success',
        amount: 12000,
        currency: 'GHS',
      },
    });
    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(Buffer.from(body))
      .digest('hex');

    await request(runtime.app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(404);
  });
});