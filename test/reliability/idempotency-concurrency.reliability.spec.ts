/*
This is a Workstream 8 reliability validation suite.
It must not add product behavior.
It must not change business logic.
It validates approved Workstreams 1-7 behavior only.
*/

import { randomUUID } from 'node:crypto';
import { PaymentProvider } from '@prisma/client';
import { PrismaEventRepository } from '../../src/modules/events/infrastructure/repositories/prisma-event.repository';
import { PaymentsService } from '../../src/modules/payments/application/payments.service';
import { InitiatePaymentUseCase } from '../../src/modules/payments/application/use-cases/initiate-payment.use-case';
import { PaymentProvider as PaymentProviderAdapter } from '../../src/modules/payments/domain/providers/payment-provider.interface';
import { PrismaPaymentIntentAuditLogRepository } from '../../src/modules/payments/infrastructure/repositories/prisma-payment-intent-audit-log.repository';
import { PrismaPaymentIntentRepository } from '../../src/modules/payments/infrastructure/repositories/prisma-payment-intent.repository';
import { RequestContextService } from '../../src/shared/context/request-context.service';
import { TransactionRunnerService } from '../../src/shared/prisma/transaction-runner.service';
import { UsersService } from '../../src/users/users.service';
import { LaunchControlDouble } from '../fixtures/doubles/launch-control.double';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from '../setup/integration-runtime';
import { seedEventInventory } from '../setup/seed-data';
import { runWithUserContext, seedPaymentIntentGraph } from '../support/ws8-reliability-fixtures';
import {
  ContainerRuntimeUnavailableError as TicketsRuntimeUnavailableError,
  createWs8TicketsAdmissionsRuntime,
  Ws8TicketsAdmissionsRuntime,
} from '../support/ws8-tickets-admissions-runtime';
import {
  buildPaystackPayload,
  ContainerRuntimeUnavailableError as WebhookRuntimeUnavailableError,
  countWebhookAudit,
  createWs8WebhookRuntime,
  delay,
  postPaystack,
  resetWebhookMocks,
  seedWebhookPaymentIntent,
  Ws8WebhookRuntime,
} from '../support/ws8-webhook-runtime';

describe('Workstream 8 idempotency and concurrency reliability', () => {
  describe('payment initiation idempotency', () => {
    let runtime: IntegrationRuntime | null = null;

    beforeAll(async () => {
      try {
        runtime = await createIntegrationRuntime();
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
      if (runtime) {
        await runtime.reset();
      }
    });

    it('reuses the same payment intent for the same idempotency key and only calls the provider once', async () => {
      if (!runtime) {
        return;
      }

      const seeded = await seedEventInventory(runtime.prisma);
      const paystackProvider = createFakePaystackProvider();
      const services = createPurchaseServices(runtime, paystackProvider);
      const idempotencyKey = `payment-${randomUUID()}`;

      const initiated = await runWithUserContext(
        services.requestContext,
        seeded.userId,
        () =>
          services.initiatePaymentUseCase.execute({
            idempotencyKey,
            eventId: seeded.eventId,
            provider: PaymentProvider.PAYSTACK,
            customerPhone: '+233555000111',
          }),
      );

      const replayed = await runWithUserContext(
        services.requestContext,
        seeded.userId,
        () =>
          services.initiatePaymentUseCase.execute({
            idempotencyKey,
            eventId: seeded.eventId,
            provider: PaymentProvider.PAYSTACK,
            customerPhone: '+233555000111',
          }),
      );

      const persistedIntent = await runtime.prisma.paymentIntent.findUniqueOrThrow({
        where: { id: initiated.paymentIntentId },
      });
      const audits = await runtime.prisma.paymentIntentAuditLog.findMany({
        where: { paymentIntentId: initiated.paymentIntentId },
        orderBy: { createdAt: 'asc' },
      });

      expect(replayed.paymentIntentId).toBe(initiated.paymentIntentId);
      expect(replayed.providerReference).toBe(initiated.providerReference);
      expect(paystackProvider.initiate).toHaveBeenCalledTimes(1);
      expect(persistedIntent.providerReference).toBe(initiated.providerReference);
      expect(audits.map((audit) => audit.eventType)).toEqual(
        expect.arrayContaining([
          'payment_initiation_requested',
          'payment_initiation_initiated',
          'payment_initiation_idempotent_replay',
        ]),
      );
    });
  });

  describe('ticket issuance concurrency', () => {
    let runtime: Ws8TicketsAdmissionsRuntime | null = null;

    beforeAll(async () => {
      try {
        runtime = await createWs8TicketsAdmissionsRuntime();
      } catch (error) {
        if (error instanceof TicketsRuntimeUnavailableError) {
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

    it('concurrent duplicate ticket issuance creates one durable ticket and a bounded audit trail', async () => {
      if (!runtime) {
        return;
      }

      const seeded = await seedPaymentIntentGraph(runtime.prisma);

      const [left, right] = await Promise.all([
        runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
          seeded.paymentIntentId,
        ),
        runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
          seeded.paymentIntentId,
        ),
      ]);

      const audits = await runtime.prisma.ticketIssuanceAuditLog.findMany({
        where: { paymentIntentId: seeded.paymentIntentId },
        orderBy: { createdAt: 'asc' },
      });

      expect(await runtime.prisma.ticket.count()).toBe(1);
      expect(left.ticket.id).toBe(right.ticket.id);
      expect([left.qrPayload, right.qrPayload].filter(Boolean)).toHaveLength(1);
      expect(audits.filter((audit) => audit.auditEvent === 'ticket_issued')).toHaveLength(1);
      expect(
        audits.filter((audit) => audit.auditEvent === 'ticket_issuance_idempotent_replay')
          .length,
      ).toBeGreaterThanOrEqual(1);
      expect(audits.length).toBeLessThanOrEqual(4);
    });
  });

  describe('webhook duplication concurrency', () => {
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

    it('concurrent duplicate successful webhooks create one webhook record and one terminal transition', async () => {
      if (!runtime) {
        return;
      }

      const seeded = await seedWebhookPaymentIntent(runtime, {
        provider: PaymentProvider.PAYSTACK,
      });

      runtime.paystackVerificationAdapter.verifyByReference.mockImplementation(
        async (reference) => {
          await delay(40);
          return {
            provider: PaymentProvider.PAYSTACK,
            providerReference: reference,
            status: 'SUCCESS',
            amountMinor: 5000,
            currency: 'GHS',
            providerStatus: 'success',
            paidAt: new Date('2026-05-11T01:00:00.000Z'),
            rawResponse: { reference },
          };
        },
      );

      const payload = buildPaystackPayload({
        reference: seeded.providerReference,
        eventId: 'evt-duplicate-transition',
      });

      await Promise.all([postPaystack(runtime.app, payload), postPaystack(runtime.app, payload)]);

      expect(
        await runtime.prisma.providerWebhookEvent.count({
          where: { providerReference: seeded.providerReference },
        }),
      ).toBe(1);
      expect(
        await countWebhookAudit(
          runtime,
          seeded.paymentIntentId,
          'payment_status_transition_verified',
        ),
      ).toBe(1);
    });
  });
});

function createPurchaseServices(
  runtime: IntegrationRuntime,
  paystackProvider: jest.Mocked<PaymentProviderAdapter>,
): {
  requestContext: RequestContextService;
  initiatePaymentUseCase: InitiatePaymentUseCase;
} {
  const requestContext = new RequestContextService();
  const transactionRunner = new TransactionRunnerService(runtime.prisma);
  const launchControl = new LaunchControlDouble();
  const eventRepository = new PrismaEventRepository(runtime.prisma);
  const paymentIntentRepository = new PrismaPaymentIntentRepository(runtime.prisma);
  const paymentIntentAuditLogRepository =
    new PrismaPaymentIntentAuditLogRepository(runtime.prisma);
  const usersService = new UsersService(runtime.prisma);
  const momoProvider = createUnusedProvider();
  const paymentsService = new PaymentsService(
    transactionRunner,
    requestContext,
    launchControl.asService(),
    usersService,
    eventRepository,
    paymentIntentRepository,
    paymentIntentAuditLogRepository,
    paystackProvider,
    momoProvider,
  );

  return {
    requestContext,
    initiatePaymentUseCase: new InitiatePaymentUseCase(paymentsService),
  };
}

function createFakePaystackProvider(): jest.Mocked<PaymentProviderAdapter> {
  const initiatePayment: jest.MockedFunction<
    PaymentProviderAdapter['initiatePayment']
  > = jest.fn(async (input) => ({
    providerReference: input.providerReference,
    checkoutUrl: 'https://example.com/pay',
    accessCode: 'access-code-1',
    rawResponse: {},
  }));
  const initiate: jest.MockedFunction<PaymentProviderAdapter['initiate']> = jest.fn(
    async (input) => initiatePayment(input),
  );
  const verifyPayment: jest.MockedFunction<
    PaymentProviderAdapter['verifyPayment']
  > = jest.fn(async (_providerRef) => {
    throw new Error('verifyPayment should not be called in this spec.');
  });
  const parseWebhook: jest.MockedFunction<
    PaymentProviderAdapter['parseWebhook']
  > = jest.fn(async (_input) => {
    throw new Error('parseWebhook should not be called in this spec.');
  });

  return {
    provider: PaymentProvider.PAYSTACK,
    initiate,
    initiatePayment,
    verifyPayment,
    parseWebhook,
  };
}

function createUnusedProvider(): jest.Mocked<PaymentProviderAdapter> {
  const initiatePayment: jest.MockedFunction<
    PaymentProviderAdapter['initiatePayment']
  > = jest.fn(async (_input) => {
    throw new Error('Unused provider should not be called.');
  });
  const initiate: jest.MockedFunction<PaymentProviderAdapter['initiate']> = jest.fn(
    async (input) => initiatePayment(input),
  );
  const verifyPayment: jest.MockedFunction<
    PaymentProviderAdapter['verifyPayment']
  > = jest.fn(async (_providerRef) => {
    throw new Error('Unused provider should not be called.');
  });
  const parseWebhook: jest.MockedFunction<
    PaymentProviderAdapter['parseWebhook']
  > = jest.fn(async (_input) => {
    throw new Error('Unused provider should not be called.');
  });

  return {
    provider: PaymentProvider.MTN_MOMO,
    initiate,
    initiatePayment,
    verifyPayment,
    parseWebhook,
  };
}