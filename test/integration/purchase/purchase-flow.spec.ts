import { randomUUID } from 'node:crypto';
import { PaymentProvider } from '@prisma/client';
import { PrismaEventRepository } from '../../../src/modules/events/infrastructure/repositories/prisma-event.repository';
import { PaymentsService } from '../../../src/modules/payments/application/payments.service';
import { InitiatePaymentUseCase } from '../../../src/modules/payments/application/use-cases/initiate-payment.use-case';
import { PaymentProvider as PaymentProviderAdapter } from '../../../src/modules/payments/domain/providers/payment-provider.interface';
import { PrismaPaymentIntentAuditLogRepository } from '../../../src/modules/payments/infrastructure/repositories/prisma-payment-intent-audit-log.repository';
import { PrismaPaymentIntentRepository } from '../../../src/modules/payments/infrastructure/repositories/prisma-payment-intent.repository';
import { RequestContextService } from '../../../src/shared/context/request-context.service';
import { TransactionRunnerService } from '../../../src/shared/prisma/transaction-runner.service';
import { UsersService } from '../../../src/users/users.service';
import { LaunchControlDouble } from '../../fixtures/doubles/launch-control.double';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from '../../setup/integration-runtime';
import { seedEventInventory } from '../../setup/seed-data';

describe('purchase flow integration', () => {
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

  it('initiates a payment intent once and reuses it for the same idempotency key', async () => {
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

    expect(initiated.status).toBe('INITIATED');
    expect(replayed.paymentIntentId).toBe(initiated.paymentIntentId);
    expect(replayed.providerReference).toBe(initiated.providerReference);
    expect(paystackProvider.initiate).toHaveBeenCalledTimes(1);
    expect(persistedIntent.status).toBe('INITIATED');
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

async function runWithUserContext<T>(
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
