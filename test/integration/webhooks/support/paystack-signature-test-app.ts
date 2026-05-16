import { APP_FILTER } from '@nestjs/core';
import {
  INestApplication,
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ORDER_REPOSITORY } from '../../../../src/modules/orders/orders.tokens';
import { HandlePaymentWebhookUseCase } from '../../../../src/modules/payments/application/use-cases/handle-payment-webhook.use-case';
import { VerifyPaymentUseCase } from '../../../../src/modules/payments/application/use-cases/verify-payment.use-case';
import { PaymentWebhooksController } from '../../../../src/modules/payments/controllers/payment-webhooks.controller';
import { PaystackAdapter } from '../../../../src/modules/payments/infrastructure/providers/paystack.adapter';
import {
  MOMO_PROVIDER,
  PAYMENT_REPOSITORY,
  PAYSTACK_PROVIDER,
} from '../../../../src/modules/payments/payments.tokens';
import { AppConfigService } from '../../../../src/shared/config/config.service';
import { RequestContextService } from '../../../../src/shared/context/request-context.service';
import { GlobalExceptionFilter } from '../../../../src/shared/errors/global-exception.filter';
import { RawBodyMiddleware } from '../../../../src/shared/http/raw-body.middleware';
import { TransactionRunnerService } from '../../../../src/shared/prisma/transaction-runner.service';
import { RedisService } from '../../../../src/shared/redis/redis.service';
import { createTestApp } from '../../../setup/test-app.factory';

type VerifyPaymentUseCaseDouble = {
  execute: jest.MockedFunction<VerifyPaymentUseCase['execute']>;
};

type RedisServiceDouble = {
  setIfNotExists: jest.MockedFunction<RedisService['setIfNotExists']>;
  delete: jest.MockedFunction<RedisService['delete']>;
};

export type PaystackSignatureTestApp = {
  app: INestApplication;
  verifyPaymentUseCase: VerifyPaymentUseCaseDouble;
  redisService: RedisServiceDouble;
  close: () => Promise<void>;
};

export async function createPaystackSignatureTestApp(): Promise<PaystackSignatureTestApp> {
  const verifyPaymentUseCase: VerifyPaymentUseCaseDouble = {
    execute: jest.fn(),
  };
  const redisService: RedisServiceDouble = {
    setIfNotExists: jest.fn(),
    delete: jest.fn(),
  };

  @Module({
    controllers: [PaymentWebhooksController],
    providers: [
      AppConfigService,
      RequestContextService,
      GlobalExceptionFilter,
      HandlePaymentWebhookUseCase,
      PaystackAdapter,
      {
        provide: APP_FILTER,
        useExisting: GlobalExceptionFilter,
      },
      {
        provide: VerifyPaymentUseCase,
        useValue: verifyPaymentUseCase,
      },
      {
        provide: RedisService,
        useValue: redisService,
      },
      {
        provide: TransactionRunnerService,
        useValue: {
          runInTransaction: jest.fn(),
        },
      },
      {
        provide: PAYMENT_REPOSITORY,
        useValue: {},
      },
      {
        provide: ORDER_REPOSITORY,
        useValue: {},
      },
      {
        provide: PAYSTACK_PROVIDER,
        useExisting: PaystackAdapter,
      },
      {
        provide: MOMO_PROVIDER,
        useValue: {
          initiatePayment: jest.fn(),
          verifyPayment: jest.fn(),
          parseWebhook: jest.fn(),
        },
      },
    ],
  })
  class PaystackSignatureTestModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(RawBodyMiddleware).forRoutes({
        path: 'payments/webhooks/:provider',
        method: RequestMethod.POST,
      });
    }
  }

  const app = await createTestApp(
    Test.createTestingModule({
      imports: [PaystackSignatureTestModule],
    }),
  );

  return {
    app,
    verifyPaymentUseCase,
    redisService,
    close: async () => {
      await app.close();
    },
  };
}