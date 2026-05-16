import { randomUUID } from 'node:crypto';
import { ReservationStatus } from '@prisma/client';
import request = require('supertest');
import {
  ContainerRuntimeUnavailableError,
  createOperationalRuntime,
  OperationalRuntime,
  TEST_AUTH_IDENTITIES,
} from '../../setup/operational-runtime';
import { seedEventInventory, seedTicketAdmission } from '../../setup/seed-data';
import { getTestGlobals } from '../../setup/test-globals';

const PILOT_ENV_KEYS = [
  'PILOT_CHECKOUT_ENABLED',
  'PILOT_PAYMENTS_ENABLED',
  'PILOT_ADMISSIONS_ENABLED',
  'PILOT_ALLOWED_PAYMENT_PROVIDERS',
  'PILOT_ALLOWED_CURRENCIES',
  'PILOT_ALLOWED_ORGANIZER_IDS',
  'PILOT_ALLOWED_EVENT_IDS',
  'PILOT_ALLOWED_GATE_IDS',
] as const;

describe('pilot launch controls integration', () => {
  it('blocks checkout for events outside the pilot event allowlist', async () => {
    await withPilotRuntime(
      {
        PILOT_ALLOWED_EVENT_IDS: '90000000-0000-4000-8000-000000000001',
      },
      async (runtime) => {
        const seeded = await seedEventInventory(runtime.prisma, {
          userId: TEST_AUTH_IDENTITIES.customer.userId,
          userEmail: TEST_AUTH_IDENTITIES.customer.email,
        });
        const reservationId = randomUUID();

        await runtime.prisma.ticketReservation.create({
          data: {
            id: reservationId,
            ownerUserId: seeded.userId,
            eventId: seeded.eventId,
            ticketTypeId: seeded.ticketTypeId,
            quantity: 1,
            status: ReservationStatus.HELD,
            expiresAt: new Date(Date.now() + 300_000),
          },
        });

        await request(runtime.app.getHttpServer())
          .post('/checkout/order')
          .set('Authorization', `Bearer ${runtime.tokens.customer}`)
          .set('Idempotency-Key', `pilot-order-${randomUUID()}`)
          .send({
            reservationId,
            totalAmountMinor: '5000',
            currency: 'GHS',
          })
          .expect(403);
      },
    );
  });

  it('blocks payment initiation when the pilot payments kill switch is off', async () => {
    await withPilotRuntime(
      {
        PILOT_PAYMENTS_ENABLED: 'false',
      },
      async (runtime) => {
        const seeded = await seedEventInventory(runtime.prisma, {
          userId: TEST_AUTH_IDENTITIES.customer.userId,
          userEmail: TEST_AUTH_IDENTITIES.customer.email,
        });

        await request(runtime.app.getHttpServer())
          .post('/payments/initiate')
          .set('Authorization', `Bearer ${runtime.tokens.customer}`)
          .set('Idempotency-Key', `pilot-payment-${randomUUID()}`)
          .send({
            provider: 'PAYSTACK',
            eventId: seeded.eventId,
          })
          .expect(503);
      },
    );
  });

  it('blocks admissions for gates outside the pilot gate allowlist', async () => {
    await withPilotRuntime(
      {
        PILOT_ALLOWED_GATE_IDS: '90000000-0000-4000-8000-000000000010',
      },
      async (runtime) => {
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
          nonce: 'pilot-gate-allowlist-nonce',
          direction: 'ENTRY',
          sessionId: 'pilot-gate-allowlist-session',
          expiresAt: new Date(Date.now() + 30_000),
        });

        await request(runtime.app.getHttpServer())
          .post('/admissions/validate')
          .set('Authorization', `Bearer ${runtime.tokens.gateAgent}`)
          .send({
            rawToken: 'x'.repeat(40),
            gateId: seeded.gateId,
            scanEventId: randomUUID(),
          })
          .expect(403);
      },
    );
  });
});

async function withPilotRuntime(
  overrides: Partial<Record<(typeof PILOT_ENV_KEYS)[number], string>>,
  callback: (runtime: OperationalRuntime) => Promise<void>,
): Promise<void> {
  const previous = capturePilotEnv();
  let runtime: OperationalRuntime | null = null;

  try {
    applyPilotEnv(overrides);

    try {
      runtime = await createOperationalRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }

    await callback(runtime);
  } finally {
    if (runtime) {
      await runtime.dispose();
    }

    restorePilotEnv(previous);
  }
}

function capturePilotEnv(): Record<(typeof PILOT_ENV_KEYS)[number], string | undefined> {
  return Object.fromEntries(
    PILOT_ENV_KEYS.map((key) => [key, process.env[key]]),
  ) as Record<(typeof PILOT_ENV_KEYS)[number], string | undefined>;
}

function applyPilotEnv(
  overrides: Partial<Record<(typeof PILOT_ENV_KEYS)[number], string>>,
): void {
  for (const key of PILOT_ENV_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }
}

function restorePilotEnv(
  previous: Record<(typeof PILOT_ENV_KEYS)[number], string | undefined>,
): void {
  for (const key of PILOT_ENV_KEYS) {
    const value = previous[key];

    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}