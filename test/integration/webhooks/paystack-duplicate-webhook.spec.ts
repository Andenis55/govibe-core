import { createHmac, randomUUID } from 'node:crypto';
import { APP_FILTER } from '@nestjs/core';
import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AUDIT_LOG_REPOSITORY } from '../../../src/modules/audit/audit.tokens';
import { PrismaAuditLogRepository } from '../../../src/modules/audit/infrastructure/repositories/prisma-audit-log.repository';
import { ORDER_REPOSITORY } from '../../../src/modules/orders/orders.tokens';
import { PrismaOrderRepository } from '../../../src/modules/orders/infrastructure/repositories/prisma-order.repository';
import { HandlePaymentWebhookUseCase } from '../../../src/modules/payments/application/use-cases/handle-payment-webhook.use-case';
import { VerifyPaymentUseCase } from '../../../src/modules/payments/application/use-cases/verify-payment.use-case';
import { PaymentWebhooksController } from '../../../src/modules/payments/controllers/payment-webhooks.controller';
import { PrismaLedgerRepository } from '../../../src/modules/payments/infrastructure/repositories/prisma-ledger.repository';
import { PrismaPaymentRepository } from '../../../src/modules/payments/infrastructure/repositories/prisma-payment.repository';
import { PaystackAdapter } from '../../../src/modules/payments/infrastructure/providers/paystack.adapter';
import {
  LEDGER_REPOSITORY,
  MOMO_PROVIDER,
  PAYMENT_REPOSITORY,
  PAYSTACK_PROVIDER,
} from '../../../src/modules/payments/payments.tokens';
import { AppConfigService } from '../../../src/shared/config/config.service';
import { RequestContextService } from '../../../src/shared/context/request-context.service';
import { GlobalExceptionFilter } from '../../../src/shared/errors/global-exception.filter';
import { RawBodyMiddleware } from '../../../src/shared/http/raw-body.middleware';
import { PrismaOutboxRepository } from '../../../src/shared/outbox/prisma-outbox.repository';
import { OUTBOX_REPOSITORY } from '../../../src/shared/outbox/outbox.tokens';
import { TransactionRunnerService } from '../../../src/shared/prisma/transaction-runner.service';
import { RedisService } from '../../../src/shared/redis/redis.service';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from '../../setup/integration-runtime';
import { seedEventInventory } from '../../setup/seed-data';
import { createTestApp } from '../../setup/test-app.factory';

describe('paystack webhook duplicate replay', () => {
  let runtime: IntegrationRuntime | null = null;
  let app: INestApplication | null = null;
  let fetchMock: jest.MockedFunction<typeof fetch>;
  const originalFetch = global.fetch;

  @Module({
    controllers: [PaymentWebhooksController],
    providers: [
      AppConfigService,
      RequestContextService,
      GlobalExceptionFilter,
      HandlePaymentWebhookUseCase,
      VerifyPaymentUseCase,
      PaystackAdapter,
      {
        provide: APP_FILTER,
        useExisting: GlobalExceptionFilter,
      },
      {
        provide: RedisService,
        useFactory: () => {
          if (!runtime) {
            throw new Error('Runtime not initialized.');
          }

          return runtime.redisService;
        },
      },
      {
        provide: TransactionRunnerService,
        useFactory: () => {
          if (!runtime) {
            throw new Error('Runtime not initialized.');
          }

          return new TransactionRunnerService(runtime.prisma);
        },
      },
      {
        provide: PAYMENT_REPOSITORY,
        useFactory: () => new PrismaPaymentRepository(),
      },
      {
        provide: LEDGER_REPOSITORY,
        useFactory: () => new PrismaLedgerRepository(),
      },
      {
        provide: ORDER_REPOSITORY,
        useFactory: () => new PrismaOrderRepository(),
      },
      {
        provide: AUDIT_LOG_REPOSITORY,
        useFactory: () => new PrismaAuditLogRepository(),
      },
      {
        provide: OUTBOX_REPOSITORY,
        useFactory: () => new PrismaOutboxRepository(),
      },
      {
        provide: PAYSTACK_PROVIDER,
        useExisting: PaystackAdapter,
      },
      {
        provide: MOMO_PROVIDER,
        useValue: {
          initiatePayment: jest.fn(async () => {
            throw new Error('Unused provider should not be called.');
          }),
          verifyPayment: jest.fn(async () => {
            throw new Error('Unused provider should not be called.');
          }),
          parseWebhook: jest.fn(async () => {
            throw new Error('Unused provider should not be called.');
          }),
        },
      },
    ],
  })
  class PaystackDuplicateWebhookModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(RawBodyMiddleware).forRoutes({
        path: 'payments/webhooks/:provider',
        method: RequestMethod.POST,
      });
    }
  }

  beforeAll(async () => {
    try {
      runtime = await createIntegrationRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }

    fetchMock = jest.fn();
    global.fetch = fetchMock;
    app = await createTestApp(
      Test.createTestingModule({
        imports: [PaystackDuplicateWebhookModule],
      }),
    );
  });

  afterAll(async () => {
    global.fetch = originalFetch;

    if (app) {
      await app.close();
    }

    if (runtime) {
      await runtime.dispose();
    }
  });

  beforeEach(async () => {
    if (!runtime) {
      return;
    }

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      new Response(
        JSON.stringify({
          data: {
            reference: 'replay-ref-1',
            status: 'success',
            amount: 12000,
            currency: 'GHS',
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    await runtime.reset();
    await seedPendingWebhookPayment(runtime);
  });

  it('does not duplicate ledger or outbox entries on repeated delivery', async () => {
    if (!runtime || !app) {
      return;
    }

    const body = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'replay-ref-1',
        status: 'success',
        amount: 12000,
        currency: 'GHS',
      },
    });

    const signature = createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(Buffer.from(body))
      .digest('hex');

    await request(app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    await request(app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('x-paystack-signature', signature)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(200);

    const payments = await runtime.prisma.payment.findMany({
      where: { providerRef: 'replay-ref-1' },
    });
    const ledgerEntries = await runtime.prisma.ledgerEntry.findMany({
      where: {
        payment: {
          providerRef: 'replay-ref-1',
        },
      },
    });
    const outboxEvents = await runtime.prisma.outboxEvent.findMany({
      where: {
        aggregateType: 'payment',
        aggregateId: payments[0]?.id,
        eventType: 'PaymentVerifiedSuccess',
      },
    });

    expect(payments).toHaveLength(1);
    expect(payments[0]?.status).toBe(PaymentStatus.SUCCESS);
    expect(ledgerEntries).toHaveLength(1);
    expect(outboxEvents).toHaveLength(1);
  });
});

async function seedPendingWebhookPayment(runtime: IntegrationRuntime): Promise<void> {
  const seeded = await seedEventInventory(runtime.prisma);
  const orderId = randomUUID();

  await runtime.prisma.order.create({
    data: {
      id: orderId,
      userId: seeded.userId,
      eventId: seeded.eventId,
      reservationId: null,
      status: OrderStatus.PAYMENT_PENDING,
      totalAmount: BigInt(12000),
      currency: 'GHS',
    },
  });

  await runtime.prisma.payment.create({
    data: {
      id: randomUUID(),
      orderId,
      provider: 'paystack',
      providerRef: 'replay-ref-1',
      status: PaymentStatus.PENDING,
      amount: BigInt(12000),
    },
  });
}