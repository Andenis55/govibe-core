import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { ValidateAdmissionScanUseCase } from '../../src/modules/admissions/application/use-cases/validate-admission-scan.use-case';
import { QR_TOKEN_VERIFIER } from '../../src/modules/admissions/admissions.tokens';
import { QrTokenVerifier } from '../../src/modules/admissions/domain/services/qr-token-verifier.interface';
import { InitiatePaymentUseCase } from '../../src/modules/payments/application/use-cases/initiate-payment.use-case';
import { VerifyPaymentUseCase } from '../../src/modules/payments/application/use-cases/verify-payment.use-case';
import { PaymentProvider } from '../../src/modules/payments/domain/providers/payment-provider.interface';
import { MOMO_PROVIDER, PAYSTACK_PROVIDER } from '../../src/modules/payments/payments.tokens';
import { RequestContextService } from '../../src/shared/context/request-context.service';
import { OUTBOX_DISPATCHER } from '../../src/shared/outbox/outbox.tokens';
import { OutboxDispatcher } from '../../src/shared/outbox/outbox.dispatcher.interface';
import { OutboxProcessor } from '../../src/shared/outbox/outbox.processor';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { AdmissionCacheService } from '../../src/shared/redis/admission-cache.service';
import { NonceCacheService } from '../../src/shared/redis/nonce-cache.service';
import { RedisService } from '../../src/shared/redis/redis.service';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from './integration-runtime';
import { createTestApp } from './test-app.factory';
import { getTestGlobals, TestAuthTokens, TestContainer } from './test-globals';
import { signTestJwt } from './test-jwt';

export const TEST_AUTH_IDENTITIES = {
  customer: {
    userId: '81000000-0000-4000-8000-000000000001',
    email: 'customer@govibe.test',
    roles: ['customer'],
    permissions: [],
  },
  gateAgent: {
    userId: '81000000-0000-4000-8000-000000000002',
    email: 'gate-agent@govibe.test',
    roles: ['gate-agent'],
    permissions: ['admissions:scan'],
    deviceId: '81000000-0000-4000-8000-000000000005',
  },
  organizerNoScan: {
    userId: '81000000-0000-4000-8000-000000000003',
    email: 'organizer@govibe.test',
    roles: ['organizer'],
    permissions: [],
    organizerId: '81000000-0000-4000-8000-000000000004',
  },
} as const;

type ContainerRegistry = {
  VerifyPaymentUseCase: VerifyPaymentUseCase;
  ValidateAdmissionScanUseCase: ValidateAdmissionScanUseCase;
  InitiatePaymentUseCase: InitiatePaymentUseCase;
  OutboxProcessor: OutboxProcessor;
  RequestContextService: RequestContextService;
};

export type OperationalRuntime = IntegrationRuntime & {
  app: INestApplication;
  container: TestContainer;
  paystackProvider: PaymentProvider;
  momoProvider: PaymentProvider;
  qrVerifier: {
    verify: jest.MockedFunction<QrTokenVerifier['verify']>;
  };
  outboxDispatcher: {
    dispatch: jest.MockedFunction<OutboxDispatcher['dispatch']>;
  };
  nonceCacheService: NonceCacheService;
  admissionCacheService: AdmissionCacheService;
  requestContext: RequestContextService;
  tokens: TestAuthTokens;
  dispose: () => Promise<void>;
};

export async function createOperationalRuntime(): Promise<OperationalRuntime> {
  const integration = await createIntegrationRuntime();
  const qrVerifier = {
    verify: jest.fn<ReturnType<QrTokenVerifier['verify']>, Parameters<QrTokenVerifier['verify']>>(),
  };
  const outboxDispatcher = {
    dispatch: jest.fn<ReturnType<OutboxDispatcher['dispatch']>, Parameters<OutboxDispatcher['dispatch']>>(),
  };

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
    .useValue(outboxDispatcher);

  const app = await createTestApp(builder, { registerGlobal: true });
  const requestContext = app.get(RequestContextService);
  const paystackProvider = app.get<PaymentProvider>(PAYSTACK_PROVIDER as never);
  const momoProvider = app.get<PaymentProvider>(MOMO_PROVIDER as never);
  const nonceCacheService = app.get(NonceCacheService);
  const admissionCacheService = app.get(AdmissionCacheService);
  const tokens = createTestAuthTokens();
  const container = createContainer(app);

  assignGlobals({
    app,
    integration,
    paystackProvider,
    momoProvider,
    qrVerifier,
    outboxDispatcher,
    nonceCacheService,
    admissionCacheService,
    tokens,
    container,
  });

  return {
    ...integration,
    app,
    container,
    paystackProvider,
    momoProvider,
    qrVerifier,
    outboxDispatcher,
    nonceCacheService,
    admissionCacheService,
    requestContext,
    tokens,
    dispose: async () => {
      const globals = getTestGlobals();

      if (globals.__APP__ === app) {
        globals.__APP__ = undefined;
      }

      if (globals.__CONTAINER__ === container) {
        globals.__CONTAINER__ = undefined;
      }

      if (globals.__PAYSTACK_PROVIDER__ === paystackProvider) {
        globals.__PAYSTACK_PROVIDER__ = undefined;
      }

      if (globals.__MOMO_PROVIDER__ === momoProvider) {
        globals.__MOMO_PROVIDER__ = undefined;
      }

      if (globals.__QR_VERIFIER__ === qrVerifier) {
        globals.__QR_VERIFIER__ = undefined;
      }

      if (globals.__OUTBOX_DISPATCHER__ === outboxDispatcher) {
        globals.__OUTBOX_DISPATCHER__ = undefined;
      }

      if (globals.__NONCE_CACHE_SERVICE__ === nonceCacheService) {
        globals.__NONCE_CACHE_SERVICE__ = undefined;
      }

      if (globals.__ADMISSION_CACHE_SERVICE__ === admissionCacheService) {
        globals.__ADMISSION_CACHE_SERVICE__ = undefined;
      }

      if (globals.__REDIS_SERVICE__ === integration.redisService) {
        globals.__REDIS_SERVICE__ = undefined;
      }

      if (globals.__TOKENS__ === tokens) {
        globals.__TOKENS__ = undefined;
      }

      await Promise.allSettled([app.close(), integration.dispose()]);
    },
  };
}

export { ContainerRuntimeUnavailableError };

function createContainer(app: INestApplication): TestContainer {
  const registry: {
    [K in keyof ContainerRegistry]: ContainerRegistry[K];
  } = {
    VerifyPaymentUseCase: app.get(VerifyPaymentUseCase),
    ValidateAdmissionScanUseCase: app.get(ValidateAdmissionScanUseCase),
    InitiatePaymentUseCase: app.get(InitiatePaymentUseCase),
    OutboxProcessor: app.get(OutboxProcessor),
    RequestContextService: app.get(RequestContextService),
  };

  return {
    resolve(name: string): unknown {
      return registry[name as keyof ContainerRegistry];
    },
  };
}

function createTestAuthTokens(): TestAuthTokens {
  return {
    customer: signTestJwt(TEST_AUTH_IDENTITIES.customer),
    gateAgent: signTestJwt(TEST_AUTH_IDENTITIES.gateAgent),
    organizerNoScan: signTestJwt(TEST_AUTH_IDENTITIES.organizerNoScan),
  };
}

function assignGlobals(input: {
  app: INestApplication;
  integration: IntegrationRuntime;
  paystackProvider: PaymentProvider;
  momoProvider: PaymentProvider;
  qrVerifier: {
    verify: jest.MockedFunction<QrTokenVerifier['verify']>;
  };
  outboxDispatcher: {
    dispatch: jest.MockedFunction<OutboxDispatcher['dispatch']>;
  };
  nonceCacheService: NonceCacheService;
  admissionCacheService: AdmissionCacheService;
  tokens: TestAuthTokens;
  container: TestContainer;
}): void {
  const globals = getTestGlobals();

  globals.__APP__ = input.app;
  globals.__PRISMA__ = input.integration.prisma;
  globals.__REDIS_CLIENT__ = input.integration.redisClient;
  globals.__REDIS_SERVICE__ = input.integration.redisService;
  globals.__PAYSTACK_PROVIDER__ = input.paystackProvider;
  globals.__MOMO_PROVIDER__ = input.momoProvider;
  globals.__QR_VERIFIER__ = input.qrVerifier;
  globals.__OUTBOX_DISPATCHER__ = input.outboxDispatcher;
  globals.__NONCE_CACHE_SERVICE__ = input.nonceCacheService;
  globals.__ADMISSION_CACHE_SERVICE__ = input.admissionCacheService;
  globals.__TOKENS__ = input.tokens;
  globals.__CONTAINER__ = input.container;
}