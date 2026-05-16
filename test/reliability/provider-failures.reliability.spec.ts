/*
This is a Workstream 8 reliability validation suite.
It must not add product behavior.
It must not change business logic.
It validates approved Workstreams 1-7 behavior only.
*/

import { createHash } from 'node:crypto';
import {
  OrderStatus,
  PaymentIntentStatus,
  PaymentProvider,
  PaymentStatus,
} from '@prisma/client';
import request = require('supertest');
import { ProviderTimeoutError } from '../../src/modules/payments/domain/providers/provider-errors';
import { VerifyPaymentUseCase } from '../../src/modules/payments/application/use-cases/verify-payment.use-case';
import {
  ContainerRuntimeUnavailableError,
  createOperationalRuntime,
  OperationalRuntime,
  TEST_AUTH_IDENTITIES,
} from '../setup/operational-runtime';
import { seedEventInventory } from '../setup/seed-data';
import { getTestGlobals } from '../setup/test-globals';
import {
  buildPaystackPayload,
  ContainerRuntimeUnavailableError as WebhookRuntimeUnavailableError,
  countWebhookAudit,
  createWs8WebhookRuntime,
  postPaystack,
  resetWebhookMocks,
  seedWebhookPaymentIntent,
  Ws8WebhookRuntime,
  WebhookProcessingStatus,
} from '../support/ws8-webhook-runtime';

describe('Workstream 8 provider failure reliability', () => {
  describe('provider initiation failures', () => {
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

    beforeEach(async () => {
      jest.restoreAllMocks();

      if (runtime) {
        await runtime.reset();
      }
    });

    it('returns 504 on initiation timeout and allows a safe retry with the same idempotency key', async () => {
      if (!runtime) {
        return;
      }

      const seeded = await seedEventInventory(runtime.prisma, {
        userId: TEST_AUTH_IDENTITIES.customer.userId,
        userEmail: TEST_AUTH_IDENTITIES.customer.email,
      });
      const expectedProviderReference = `pi_${createHash('sha256')
        .update('provider-timeout-init-1')
        .digest('hex')
        .slice(0, 24)}`;

      jest
        .spyOn(getTestGlobals().__PAYSTACK_PROVIDER__!, 'initiatePayment')
        .mockRejectedValueOnce(
          new ProviderTimeoutError('paystack', 'Paystack request timed out.'),
        )
        .mockResolvedValueOnce({
          providerReference: expectedProviderReference,
          checkoutUrl: 'https://example.com/pay',
          accessCode: 'access-timeout-init-1',
          rawResponse: {},
        });

      await request(runtime.app.getHttpServer())
        .post('/payments/initiate')
        .set('Authorization', `Bearer ${runtime.tokens.customer}`)
        .set('Idempotency-Key', 'provider-timeout-init-1')
        .send({
          eventId: seeded.eventId,
          provider: 'PAYSTACK',
        })
        .expect(504);

      await request(runtime.app.getHttpServer())
        .post('/payments/initiate')
        .set('Authorization', `Bearer ${runtime.tokens.customer}`)
        .set('Idempotency-Key', 'provider-timeout-init-1')
        .send({
          eventId: seeded.eventId,
          provider: 'PAYSTACK',
        })
        .expect(201);

      const paymentIntents = await runtime.prisma.paymentIntent.findMany({
        where: {
          buyerUserId: TEST_AUTH_IDENTITIES.customer.userId,
          eventId: seeded.eventId,
        },
      });

      expect(paymentIntents).toHaveLength(1);
      expect(paymentIntents[0]?.status).toBe(PaymentIntentStatus.INITIATED);
      expect(paymentIntents[0]?.providerReference).toBe(expectedProviderReference);
    });

    it('does not mutate payment or order state when direct verification times out', async () => {
      if (!runtime) {
        return;
      }

      const seeded = await seedEventInventory(runtime.prisma, {
        userId: TEST_AUTH_IDENTITIES.customer.userId,
        userEmail: TEST_AUTH_IDENTITIES.customer.email,
      });
      const globals = getTestGlobals();
      const verifyPayment = globals.__CONTAINER__?.resolve(
        'VerifyPaymentUseCase',
      ) as VerifyPaymentUseCase;

      await runtime.prisma.order.create({
        data: {
          id: '82000000-0000-4000-8000-000000000001',
          userId: TEST_AUTH_IDENTITIES.customer.userId,
          eventId: seeded.eventId,
          status: OrderStatus.PAYMENT_PENDING,
          totalAmount: BigInt(12000),
          currency: 'GHS',
        },
      });
      await runtime.prisma.payment.create({
        data: {
          id: '82000000-0000-4000-8000-000000000002',
          orderId: '82000000-0000-4000-8000-000000000001',
          provider: 'paystack',
          providerRef: 'timeout-ref-1',
          status: PaymentStatus.PENDING,
          amount: BigInt(12000),
        },
      });

      jest
        .spyOn(globals.__PAYSTACK_PROVIDER__!, 'verifyPayment')
        .mockRejectedValueOnce(
          new ProviderTimeoutError(
            'paystack',
            'Paystack verification timed out.',
          ),
        );

      await expect(
        verifyPayment.execute({
          provider: 'paystack',
          providerRef: 'timeout-ref-1',
          verifiedSuccess: false,
          verifiedCurrency: 'GHS',
        }),
      ).rejects.toThrow('Paystack verification timed out.');

      const payment = await runtime.prisma.payment.findUnique({
        where: { id: '82000000-0000-4000-8000-000000000002' },
      });
      const order = await runtime.prisma.order.findUnique({
        where: { id: '82000000-0000-4000-8000-000000000001' },
      });

      expect(payment?.status).toBe(PaymentStatus.PENDING);
      expect(order?.status).toBe(OrderStatus.PAYMENT_PENDING);
      expect(
        await runtime.prisma.ledgerEntry.count({
          where: { paymentId: '82000000-0000-4000-8000-000000000002' },
        }),
      ).toBe(0);
    });
  });

  describe('webhook verification failures', () => {
    let runtime: Ws8WebhookRuntime | null = null;

    beforeAll(async () => {
      try {
        runtime = await createWs8WebhookRuntime();
      } catch (error) {
        if (error instanceof WebhookRuntimeUnavailableError) {
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

    beforeEach(async () => {
      if (!runtime) {
        return;
      }

      await runtime.reset();
      resetWebhookMocks(runtime);
    });

    it('invalid signature fails closed without calling provider verification adapters', async () => {
      if (!runtime) {
        return;
      }

      const seeded = await seedWebhookPaymentIntent(runtime, {
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

      expect(runtime.paystackVerificationAdapter.verifyByReference).not.toHaveBeenCalled();
      expect(runtime.momoVerificationAdapter.verifyByReference).not.toHaveBeenCalled();
    });

    it('provider verification timeout does not mark PaymentIntent FAILED and records webhook failure state', async () => {
      if (!runtime) {
        return;
      }

      const seeded = await seedWebhookPaymentIntent(runtime, {
        provider: PaymentProvider.PAYSTACK,
      });

      runtime.paystackVerificationAdapter.verifyByReference.mockRejectedValueOnce({
        name: 'ProviderTimeoutError',
        provider: 'paystack',
        message: 'Paystack verification timed out.',
      });

      const signedPayload = buildPaystackPayload({
        reference: seeded.providerReference,
        eventId: 'evt-timeout',
      });

      await postPaystack(runtime.app, signedPayload).expect(200);

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
        await countWebhookAudit(
          runtime,
          seeded.paymentIntentId,
          'payment_verification_failed',
        ),
      ).toBe(1);
    });
  });
});