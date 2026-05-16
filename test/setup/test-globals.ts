import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { QrTokenVerifier } from '../../src/modules/admissions/domain/services/qr-token-verifier.interface';
import { PaymentProvider } from '../../src/modules/payments/domain/providers/payment-provider.interface';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisService } from '../../src/shared/redis/redis.service';
import { AdmissionCacheService } from '../../src/shared/redis/admission-cache.service';
import { NonceCacheService } from '../../src/shared/redis/nonce-cache.service';
import { OutboxDispatcher } from '../../src/shared/outbox/outbox.dispatcher.interface';

export type TestQrVerifier = {
  verify: jest.MockedFunction<QrTokenVerifier['verify']>;
};

export type TestOutboxDispatcher = {
  dispatch: jest.MockedFunction<OutboxDispatcher['dispatch']>;
};

export type TestAuthTokens = {
  customer: string;
  gateAgent: string;
  organizerNoScan: string;
};

export type TestContainer = {
  resolve(name: string): unknown;
};

export type TestGlobals = typeof globalThis & {
  __APP__?: INestApplication;
  __PRISMA__?: PrismaService;
  __REDIS_CLIENT__?: Redis;
  __REDIS_SERVICE__?: RedisService;
  __PAYSTACK_PROVIDER__?: PaymentProvider;
  __MOMO_PROVIDER__?: PaymentProvider;
  __QR_VERIFIER__?: TestQrVerifier;
  __OUTBOX_DISPATCHER__?: TestOutboxDispatcher;
  __NONCE_CACHE_SERVICE__?: NonceCacheService;
  __ADMISSION_CACHE_SERVICE__?: AdmissionCacheService;
  __TOKENS__?: TestAuthTokens;
  __CONTAINER__?: TestContainer;
};

export function getTestGlobals(): TestGlobals {
  return globalThis as TestGlobals;
}