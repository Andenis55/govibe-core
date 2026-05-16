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
import { AppModule } from '../src/app.module';
import { QR_TOKEN_VERIFIER } from '../src/modules/admissions/admissions.tokens';
import { MtnMomoVerificationAdapter } from '../src/modules/payments/verification/mtn-momo-verification.adapter';
import { PaystackVerificationAdapter } from '../src/modules/payments/verification/paystack-verification.adapter';
import { ProviderVerificationResult } from '../src/modules/payments/verification/provider-verification.types';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { RedisService } from '../src/shared/redis/redis.service';
import { OUTBOX_DISPATCHER } from '../src/shared/outbox/outbox.tokens';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from './setup/integration-runtime';
import { seedEventInventory } from './setup/seed-data';
import { createTestApp } from './setup/test-app.factory';

type VerificationWebhookRuntime = IntegrationRuntime & {
  app: INestApplication;
  dispose: () => Promise<void>;
};

type SeededPaymentIntent = {
  userId: string;
  organizerId: string;
  eventId: string;
  ticketTypeId: string;
  paymentIntentId: string;
  providerReference: string;
};

describe('Payments verification webhooks', () => {
  let runtime: VerificationWebhookRuntime | null = null;

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

  beforeAll(async () => {
    let integration: IntegrationRuntime;

    try {
      integration = await createIntegrationRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }

    const qrVerifier = { verify: jest.fn() };
    const outboxDispatcher = { dispatch: jest.fn() };

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
      .useValue(qrVerifier)
      .overrideProvider(OUTBOX_DISPATCHER)
      .useValue(outboxDispatcher)
      .overrideProvider(PaystackVerificationAdapter)
      .useValue(paystackVerificationAdapter)
      .overrideProvider(MtnMomoVerificationAdapter)
      .useValue(momoVerificationAdapter);

    const app = await createTestApp(builder);

    runtime = {
      ...integration,
      app,
      dispose: async () => {
        await Promise.allSettled([app.close(), integration.dispose()]);
      },
    };
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  beforeEach(async () => {
    if (!runtime) {
      return;
    }

    await runtime.reset();
    paystackResults.clear();
    momoResults.clear();
    paystackVerificationAdapter.verifyByReference.mockReset();
    momoVerificationAdapter.verifyByReference.mockReset();
    paystackVerificationAdapter.verifyByReference.mockImplementation(async (reference) => {
      const result = paystackResults.get(reference);

      if (!result) {
        throw new Error(`No Paystack verification mock configured for ${reference}`);
      }

      if (result instanceof Error) {
        throw result;
      }

      return result;
    });
    momoVerificationAdapter.verifyByReference.mockImplementation(async (reference) => {
      const result = momoResults.get(reference);

      if (!result) {
        throw new Error(`No MoMo verification mock configured for ${reference}`);
      }

      if (result instanceof Error) {
        throw result;
      }

      return result;
    });
  });

  it('public webhook route bypasses JWT using the existing @Public pattern only', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.PAYSTACK,
    });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');
    const payload = buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-public-1',
    });

    await postPaystack(runtime.app, payload).expect(200);
  });

  it('missing Paystack signature returns 401', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.PAYSTACK,
    });
    const payload = buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-missing-signature',
    });

    await request(runtime.app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .send(payload)
      .expect(401);

    expect(paystackVerificationAdapter.verifyByReference).not.toHaveBeenCalled();

    const events = await runtime.prisma.providerWebhookEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]?.signatureValid).toBe(false);
    expect(events[0]?.processingStatus).toBe(WebhookProcessingStatus.REJECTED);
  });

  it('invalid Paystack signature returns 401 and does not call provider verification', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.PAYSTACK,
    });
    const payload = buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-invalid-signature',
    });

    await request(runtime.app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'invalid-signature')
      .send(payload)
      .expect(401);

    expect(paystackVerificationAdapter.verifyByReference).not.toHaveBeenCalled();
  });

  it('valid Paystack signature is accepted', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.PAYSTACK,
    });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');
    const payload = buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-valid-signature',
    });

    const response = await postPaystack(runtime.app, payload).expect(200);

    expect(response.body.acknowledged).toBe(true);
    expect(response.body.paymentIntentId).toBe(seeded.paymentIntentId);
  });

  it('uses raw body bytes for Paystack signature verification instead of reserialized JSON', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.PAYSTACK,
    });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');
    const rawPayload = '{"event":"charge.success","data": {"id":"evt-raw-1","reference":"' + seeded.providerReference + '","status":"success","amount":5000,"currency":"GHS"}}';
    const reserializedSignature = signPaystackPayload(
      JSON.stringify(JSON.parse(rawPayload)),
    );

    await postPaystack(runtime.app, rawPayload).expect(200);

    await request(runtime.app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', reserializedSignature)
      .send(rawPayload)
      .expect(401);
  });

  it('malformed JSON with invalid signature is handled safely', async () => {
    if (!runtime) {
      return;
    }

    const response = await request(runtime.app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .set('x-paystack-signature', 'invalid-signature')
      .send('{"event":')
      .expect(400);

    expect(response.body.error.statusCode ?? response.status).toBe(400);
    expect(paystackVerificationAdapter.verifyByReference).not.toHaveBeenCalled();
  });

  it('unsupported Paystack event type returns 2xx and does not mutate PaymentIntent', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.PAYSTACK,
    });
    const payload = buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-unsupported',
      event: 'charge.dispute.create',
    });

    await postPaystack(runtime.app, payload).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.INITIATED);
    expect(paystackVerificationAdapter.verifyByReference).not.toHaveBeenCalled();
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_webhook_unsupported_event_ignored'),
    ).toBe(1);
  });

  it('charge.success verifies the provider transaction before marking VERIFIED', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');
    const payload = buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-success-1' });

    await postPaystack(runtime.app, payload).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paystackVerificationAdapter.verifyByReference).toHaveBeenCalledWith(
      seeded.providerReference,
    );
    expect(paymentIntent.status).toBe(PaymentIntentStatus.VERIFIED);
    expect(paymentIntent.verifiedAt).not.toBeNull();
  });

  it('Paystack success with wrong amount does not mark VERIFIED', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    mockPaystackResult(seeded.providerReference, 'SUCCESS', { amountMinor: 7000 });
    const payload = buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-amount-mismatch' });

    await postPaystack(runtime.app, payload).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.INITIATED);
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_verification_amount_mismatch'),
    ).toBe(1);
  });

  it('Paystack success with wrong currency does not mark VERIFIED', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    mockPaystackResult(seeded.providerReference, 'SUCCESS', { currency: 'NGN' });
    const payload = buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-currency-mismatch' });

    await postPaystack(runtime.app, payload).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.INITIATED);
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_verification_currency_mismatch'),
    ).toBe(1);
  });

  it('Paystack success with wrong reference does not mark VERIFIED', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    mockPaystackResult(seeded.providerReference, 'SUCCESS', {
      providerReference: 'unexpected-reference',
    });
    const payload = buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-reference-mismatch' });

    await postPaystack(runtime.app, payload).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.INITIATED);
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_verification_reference_mismatch'),
    ).toBe(1);
  });

  it('uses the PaymentIntent snapshot instead of the current Event price for amount verification', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    mockPaystackResult(seeded.providerReference, 'SUCCESS', { amountMinor: 5000 });
    await runtime.prisma.event.update({
      where: { id: seeded.eventId },
      data: {
        priceMinor: 9000,
        priceCurrency: 'NGN',
      },
    });

    await postPaystack(
      runtime.app,
      buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-snapshot-check' }),
    ).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.VERIFIED);
  });

  it('provider verification timeout does not mark PaymentIntent FAILED and records webhook failure state', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    paystackResults.set(
      seeded.providerReference,
      new Error('timeout') as Error,
    );
    paystackVerificationAdapter.verifyByReference.mockRejectedValueOnce({
      name: 'ProviderTimeoutError',
      provider: 'paystack',
      message: 'Paystack verification timed out.',
    });

    await postPaystack(
      runtime.app,
      buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-timeout' }),
    ).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    const webhookEvent = await runtime.prisma.providerWebhookEvent.findFirstOrThrow({
      where: { providerReference: seeded.providerReference },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.INITIATED);
    expect(webhookEvent.processingStatus).toBe(WebhookProcessingStatus.FAILED);
    expect(webhookEvent.failureCode).toBe('PROVIDER_VERIFICATION_TIMEOUT');
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_verification_failed'),
    ).toBe(1);
  });

  it('duplicate webhook insert race is accepted as a duplicate', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    paystackVerificationAdapter.verifyByReference.mockImplementation(async (reference) => {
      await delay(40);
      return buildVerificationResult(PaymentProvider.PAYSTACK, reference, 'SUCCESS');
    });
    const payload = buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-duplicate-race' });

    const [first, second] = await Promise.all([
      postPaystack(runtime.app, payload),
      postPaystack(runtime.app, payload),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(
      await runtime.prisma.providerWebhookEvent.count({
        where: { providerReference: seeded.providerReference },
      }),
    ).toBe(1);
  });

  it('concurrent duplicate successful webhooks create only one terminal transition', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    paystackVerificationAdapter.verifyByReference.mockImplementation(async (reference) => {
      await delay(40);
      return buildVerificationResult(PaymentProvider.PAYSTACK, reference, 'SUCCESS');
    });
    const payload = buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-duplicate-transition' });

    await Promise.all([postPaystack(runtime.app, payload), postPaystack(runtime.app, payload)]);

    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_status_transition_verified'),
    ).toBe(1);
  });

  it('duplicate webhook after VERIFIED returns 2xx and creates no duplicate transition audit', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');
    const payload = buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-after-verified' });

    await postPaystack(runtime.app, payload).expect(200);
    await postPaystack(runtime.app, payload).expect(200);

    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_status_transition_verified'),
    ).toBe(1);
  });

  it('uses the database status guard to prevent duplicate terminal updates from distinct webhook events', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK, status: PaymentIntentStatus.INITIATION_PENDING });
    paystackVerificationAdapter.verifyByReference.mockImplementation(async (reference) => {
      await delay(25);
      return buildVerificationResult(PaymentProvider.PAYSTACK, reference, 'SUCCESS');
    });

    await Promise.all([
      postPaystack(runtime.app, buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-guard-a' })),
      postPaystack(runtime.app, buildPaystackPayload({ reference: seeded.providerReference, eventId: 'evt-guard-b' })),
    ]);

    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_status_transition_verified'),
    ).toBe(1);
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_status_transition_skipped_already_processed'),
    ).toBe(1);
  });

  it('blocks VERIFIED to FAILED regression and audits the rejection', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.PAYSTACK,
      status: PaymentIntentStatus.VERIFIED,
    });
    mockPaystackResult(seeded.providerReference, 'FAILED');

    await postPaystack(runtime.app, buildPaystackPayload({
      reference: seeded.providerReference,
      event: 'charge.failed',
      eventId: 'evt-verified-to-failed',
    })).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.VERIFIED);
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_status_transition_rejected'),
    ).toBe(1);
  });

  it('blocks FAILED to VERIFIED regression and audits the rejection', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.PAYSTACK,
      status: PaymentIntentStatus.FAILED,
    });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');

    await postPaystack(runtime.app, buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-failed-to-verified',
    })).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.FAILED);
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_status_transition_rejected'),
    ).toBe(1);
  });

  it('does not allow INITIATION_FAILED to become VERIFIED', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.PAYSTACK,
      status: PaymentIntentStatus.INITIATION_FAILED,
    });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');

    await postPaystack(runtime.app, buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-initiation-failed-block',
    })).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.INITIATION_FAILED);
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_status_transition_rejected'),
    ).toBe(1);
  });

  it('MTN callback does not transition state without status lookup adapter confirmation', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.MTN_MOMO,
    });
    mockMomoResult(seeded.providerReference, 'PENDING');

    await postMomo(runtime.app, {
      referenceId: seeded.providerReference,
      status: 'SUCCESSFUL',
    }).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(momoVerificationAdapter.verifyByReference).toHaveBeenCalledWith(
      seeded.providerReference,
    );
    expect(paymentIntent.status).toBe(PaymentIntentStatus.INITIATED);
  });

  it('MTN SUCCESSFUL status marks VERIFIED', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.MTN_MOMO,
    });
    mockMomoResult(seeded.providerReference, 'SUCCESS');

    await postMomo(runtime.app, {
      referenceId: seeded.providerReference,
      status: 'SUCCESSFUL',
    }).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.VERIFIED);
  });

  it.each(['FAILED', 'EXPIRED'])('MTN %s status marks FAILED', async (providerStatus) => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.MTN_MOMO,
    });
    mockMomoResult(seeded.providerReference, 'FAILED', { providerStatus });

    await postMomo(runtime.app, {
      referenceId: seeded.providerReference,
      status: providerStatus,
    }).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.FAILED);
  });

  it('MTN PENDING status does not mark VERIFIED', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.MTN_MOMO,
    });
    mockMomoResult(seeded.providerReference, 'PENDING');

    await postMomo(runtime.app, {
      referenceId: seeded.providerReference,
      status: 'PENDING',
    }).expect(200);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.INITIATED);
    expect(
      await countAudit(runtime, seeded.paymentIntentId, 'payment_verification_pending'),
    ).toBe(1);
  });

  it('stores MTN callback evidence with signatureValid set to null', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, {
      provider: PaymentProvider.MTN_MOMO,
    });
    mockMomoResult(seeded.providerReference, 'SUCCESS');

    await postMomo(runtime.app, {
      referenceId: seeded.providerReference,
      status: 'SUCCESSFUL',
    }).expect(200);

    const webhookEvent = await runtime.prisma.providerWebhookEvent.findFirstOrThrow({
      where: { providerReference: seeded.providerReference },
    });
    expect(webhookEvent.signatureValid).toBeNull();
  });

  it('verification does not issue tickets', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');

    await postPaystack(runtime.app, buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-no-tickets',
    })).expect(200);

    expect(await runtime.prisma.ticket.count()).toBe(0);
  });

  it('verification does not create QR or admission records', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');

    await postPaystack(runtime.app, buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-no-admissions',
    })).expect(200);

    expect(await runtime.prisma.ticketAdmissionState.count()).toBe(0);
    expect(await runtime.prisma.admissionEvent.count()).toBe(0);
  });

  it('verification does not trigger payout or refund side effects', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });
    mockPaystackResult(seeded.providerReference, 'SUCCESS');

    await postPaystack(runtime.app, buildPaystackPayload({
      reference: seeded.providerReference,
      eventId: 'evt-no-payout-refund',
    })).expect(200);

    expect(
      await runtime.prisma.outboxEvent.count({
        where: {
          OR: [
            { eventType: { contains: 'Refund' } },
            { eventType: { contains: 'Payout' } },
          ],
        },
      }),
    ).toBe(0);
  });

  it('browser return URLs cannot mark payment verified', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntent(runtime, { provider: PaymentProvider.PAYSTACK });

    await request(runtime.app.getHttpServer())
      .get(`/payments/return?reference=${seeded.providerReference}&status=success`)
      .expect(404);

    const paymentIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
      where: { id: seeded.paymentIntentId },
    });
    expect(paymentIntent.status).toBe(PaymentIntentStatus.INITIATED);
  });

  function mockPaystackResult(
    providerReference: string,
    status: ProviderVerificationResult['status'],
    overrides?: Partial<ProviderVerificationResult>,
  ): void {
    paystackResults.set(
      providerReference,
      buildVerificationResult(PaymentProvider.PAYSTACK, providerReference, status, overrides),
    );
  }

  function mockMomoResult(
    providerReference: string,
    status: ProviderVerificationResult['status'],
    overrides?: Partial<ProviderVerificationResult>,
  ): void {
    momoResults.set(
      providerReference,
      buildVerificationResult(PaymentProvider.MTN_MOMO, providerReference, status, overrides),
    );
  }
});

async function seedPaymentIntent(
  runtime: VerificationWebhookRuntime,
  overrides?: Partial<{
    provider: PaymentProvider;
    status: PaymentIntentStatus;
    amountMinor: number;
    currency: string;
    providerReference: string;
  }>,
): Promise<SeededPaymentIntent> {
  const seeded = await seedEventInventory(runtime.prisma);
  const paymentIntentId = randomUUID();
  const providerReference =
    overrides?.providerReference ?? `pi_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
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

  await runtime.prisma.paymentIntent.create({
    data,
  });

  return {
    userId: seeded.userId,
    organizerId: seeded.userId,
    eventId: seeded.eventId,
    ticketTypeId: seeded.ticketTypeId,
    paymentIntentId,
    providerReference,
  };
}

function buildPaystackPayload(input: {
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

function signPaystackPayload(payload: string): string {
  return createHmac('sha512', process.env.PAYSTACK_SECRET_KEY ?? '')
    .update(Buffer.from(payload))
    .digest('hex');
}

function postPaystack(app: INestApplication, payload: string) {
  return request(app.getHttpServer())
    .post('/payments/webhooks/paystack')
    .set('Content-Type', 'application/json')
    .set('x-paystack-signature', signPaystackPayload(payload))
    .send(payload);
}

function postMomo(app: INestApplication, payload: Record<string, unknown>) {
  return request(app.getHttpServer())
    .post('/payments/webhooks/mtn-momo')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify(payload));
}

function buildVerificationResult(
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

async function countAudit(
  runtime: VerificationWebhookRuntime,
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

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}