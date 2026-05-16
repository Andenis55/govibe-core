import { createHash, createHmac, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  PaymentIntentStatus,
  PaymentProvider,
  Prisma,
  WebhookProcessingStatus,
} from '@prisma/client';
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { QR_TOKEN_VERIFIER } from '../../src/modules/admissions/admissions.tokens';
import { MtnMomoVerificationAdapter } from '../../src/modules/payments/verification/mtn-momo-verification.adapter';
import { PaystackVerificationAdapter } from '../../src/modules/payments/verification/paystack-verification.adapter';
import { ProviderVerificationResult } from '../../src/modules/payments/verification/provider-verification.types';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisService } from '../../src/shared/redis/redis.service';
import { OUTBOX_DISPATCHER } from '../../src/shared/outbox/outbox.tokens';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from '../setup/integration-runtime';
import { seedEventInventory } from '../setup/seed-data';
import { createTestApp } from '../setup/test-app.factory';

export type Ws8WebhookRuntime = IntegrationRuntime & {
  app: INestApplication;
  paystackVerificationAdapter: {
    provider: PaymentProvider;
    verifyByReference: jest.Mock<Promise<ProviderVerificationResult>, [string]>;
  };
  momoVerificationAdapter: {
    provider: PaymentProvider;
    verifyByReference: jest.Mock<Promise<ProviderVerificationResult>, [string]>;
  };
  paystackResults: Map<string, ProviderVerificationResult | Error>;
  momoResults: Map<string, ProviderVerificationResult | Error>;
  dispose: () => Promise<void>;
};

export type SeededWebhookPaymentIntent = {
  userId: string;
  organizerId: string;
  eventId: string;
  ticketTypeId: string;
  paymentIntentId: string;
  providerReference: string;
};

export async function createWs8WebhookRuntime(): Promise<Ws8WebhookRuntime> {
  let integration: IntegrationRuntime;

  try {
    integration = await createIntegrationRuntime();
  } catch (error) {
    if (error instanceof ContainerRuntimeUnavailableError) {
      throw error;
    }

    throw error;
  }

  const paystackVerificationAdapter = {
    provider: PaymentProvider.PAYSTACK,
    verifyByReference: jest.fn<Promise<ProviderVerificationResult>, [string]>(),
  };
  const momoVerificationAdapter = {
    provider: PaymentProvider.MTN_MOMO,
    verifyByReference: jest.fn<Promise<ProviderVerificationResult>, [string]>(),
  };
  const paystackResults = new Map<string, ProviderVerificationResult | Error>();
  const momoResults = new Map<string, ProviderVerificationResult | Error>();

  const builder = Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue(integration.prisma)
    .overrideProvider('REDIS_CLIENT')
    .useValue(integration.redisClient)
    .overrideProvider(RedisService)
    .useValue(integration.redisService)
    .overrideProvider(QR_TOKEN_VERIFIER)
    .useValue({ verify: jest.fn() })
    .overrideProvider(OUTBOX_DISPATCHER)
    .useValue({ dispatch: jest.fn() })
    .overrideProvider(PaystackVerificationAdapter)
    .useValue(paystackVerificationAdapter)
    .overrideProvider(MtnMomoVerificationAdapter)
    .useValue(momoVerificationAdapter);

  const app = await createTestApp(builder);

  return {
    ...integration,
    app,
    paystackVerificationAdapter,
    momoVerificationAdapter,
    paystackResults,
    momoResults,
    dispose: async () => {
      await Promise.allSettled([app.close(), integration.dispose()]);
    },
  };
}

export function resetWebhookMocks(runtime: Ws8WebhookRuntime): void {
  runtime.paystackResults.clear();
  runtime.momoResults.clear();
  runtime.paystackVerificationAdapter.verifyByReference.mockReset();
  runtime.momoVerificationAdapter.verifyByReference.mockReset();
  runtime.paystackVerificationAdapter.verifyByReference.mockImplementation(
    async (reference) => {
      const result = runtime.paystackResults.get(reference);

      if (!result) {
        throw new Error(`No Paystack verification mock configured for ${reference}`);
      }

      if (result instanceof Error) {
        throw result;
      }

      return result;
    },
  );
  runtime.momoVerificationAdapter.verifyByReference.mockImplementation(
    async (reference) => {
      const result = runtime.momoResults.get(reference);

      if (!result) {
        throw new Error(`No MoMo verification mock configured for ${reference}`);
      }

      if (result instanceof Error) {
        throw result;
      }

      return result;
    },
  );
}

export async function seedWebhookPaymentIntent(
  runtime: Ws8WebhookRuntime,
  overrides?: Partial<{
    provider: PaymentProvider;
    status: PaymentIntentStatus;
    amountMinor: number;
    currency: string;
    providerReference: string;
  }>,
): Promise<SeededWebhookPaymentIntent> {
  const seeded = await seedEventInventory(runtime.prisma);
  const paymentIntentId = randomUUID();
  const providerReference =
    overrides?.providerReference ??
    `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const status = overrides?.status ?? PaymentIntentStatus.INITIATED;
  const amountMinor = overrides?.amountMinor ?? 5000;
  const currency = overrides?.currency ?? 'GHS';
  const data: Prisma.PaymentIntentUncheckedCreateInput = {
    id: paymentIntentId,
    buyerUserId: seeded.userId,
    organizerId: seeded.userId,
    eventId: seeded.eventId,
    provider: overrides?.provider ?? PaymentProvider.PAYSTACK,
    status,
    amountMinor,
    currency,
    idempotencyUseCase: 'payments.initiate',
    idempotencyKeyHash: hashValue(`${paymentIntentId}:idem`),
    requestFingerprintHash: hashValue(`${paymentIntentId}:fingerprint`),
    providerReference,
    initiatedAt:
      status === PaymentIntentStatus.INITIATED ||
      status === PaymentIntentStatus.VERIFIED ||
      status === PaymentIntentStatus.FAILED
        ? new Date('2026-05-11T00:00:00.000Z')
        : null,
    verifiedAt:
      status === PaymentIntentStatus.VERIFIED
        ? new Date('2026-05-11T00:05:00.000Z')
        : null,
    failedAt:
      status === PaymentIntentStatus.FAILED ||
      status === PaymentIntentStatus.INITIATION_FAILED
        ? new Date('2026-05-11T00:10:00.000Z')
        : null,
    failureCode:
      status === PaymentIntentStatus.FAILED ||
      status === PaymentIntentStatus.INITIATION_FAILED
        ? 'SEEDED_FAILURE'
        : null,
    failureMessage:
      status === PaymentIntentStatus.FAILED ||
      status === PaymentIntentStatus.INITIATION_FAILED
        ? 'Seeded terminal failure state.'
        : null,
    providerVerifiedStatus:
      status === PaymentIntentStatus.VERIFIED ||
      status === PaymentIntentStatus.FAILED
        ? 'seeded'
        : null,
    providerVerifiedAmount:
      status === PaymentIntentStatus.VERIFIED ||
      status === PaymentIntentStatus.FAILED
        ? amountMinor
        : null,
    providerVerifiedCurrency:
      status === PaymentIntentStatus.VERIFIED ||
      status === PaymentIntentStatus.FAILED
        ? currency
        : null,
  };

  if (
    status === PaymentIntentStatus.VERIFIED ||
    status === PaymentIntentStatus.FAILED
  ) {
    data.providerVerificationRaw = { seeded: true };
  }

  await runtime.prisma.paymentIntent.create({ data });

  return {
    userId: seeded.userId,
    organizerId: seeded.userId,
    eventId: seeded.eventId,
    ticketTypeId: seeded.ticketTypeId,
    paymentIntentId,
    providerReference,
  };
}

export function mockPaystackResult(
  runtime: Ws8WebhookRuntime,
  providerReference: string,
  status: ProviderVerificationResult['status'],
  overrides?: Partial<ProviderVerificationResult>,
): void {
  runtime.paystackResults.set(
    providerReference,
    buildVerificationResult(
      PaymentProvider.PAYSTACK,
      providerReference,
      status,
      overrides,
    ),
  );
}

export function mockMomoResult(
  runtime: Ws8WebhookRuntime,
  providerReference: string,
  status: ProviderVerificationResult['status'],
  overrides?: Partial<ProviderVerificationResult>,
): void {
  runtime.momoResults.set(
    providerReference,
    buildVerificationResult(
      PaymentProvider.MTN_MOMO,
      providerReference,
      status,
      overrides,
    ),
  );
}

export function buildPaystackPayload(input: {
  reference: string;
  eventId: string;
  event?: string;
  status?: string;
  amount?: number;
  currency?: string;
}): string {
  return JSON.stringify({
    event: input.event ?? 'charge.success',
    data: {
      id: input.eventId,
      reference: input.reference,
      status: input.status ?? 'success',
      amount: input.amount ?? 5000,
      currency: input.currency ?? 'GHS',
    },
  });
}

export function signPaystackPayload(payload: string): string {
  return createHmac('sha512', process.env.PAYSTACK_SECRET_KEY ?? '')
    .update(Buffer.from(payload))
    .digest('hex');
}

export function postPaystack(app: INestApplication, payload: string) {
  return request(app.getHttpServer())
    .post('/payments/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', signPaystackPayload(payload))
    .send(payload);
}

export function postMomo(app: INestApplication, payload: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post('/payments/webhooks/mtn-momo')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(payload));
}

export function buildVerificationResult(
  provider: PaymentProvider,
  providerReference: string,
  status: ProviderVerificationResult['status'],
  overrides?: Partial<ProviderVerificationResult>,
): ProviderVerificationResult {
  return {
    provider,
    providerReference,
    status,
    amountMinor: 5000,
    currency: 'GHS',
    providerStatus:
      status === 'SUCCESS'
        ? provider === PaymentProvider.PAYSTACK
          ? 'success'
          : 'SUCCESSFUL'
        : status === 'FAILED'
          ? provider === PaymentProvider.PAYSTACK
            ? 'failed'
            : 'FAILED'
          : 'PENDING',
    paidAt: status === 'SUCCESS' ? new Date('2026-05-11T01:00:00.000Z') : null,
    rawResponse: { providerReference, status },
    ...overrides,
  };
}

export async function countWebhookAudit(
  runtime: Ws8WebhookRuntime,
  paymentIntentId: string,
  eventType: string,
): Promise<number> {
  return runtime.prisma.paymentIntentAuditLog.count({
    where: {
      paymentIntentId,
      eventType,
    },
  });
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export { ContainerRuntimeUnavailableError, WebhookProcessingStatus };