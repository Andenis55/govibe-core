/*
This is a Workstream 8 reliability validation suite.
It must not add product behavior.
It must not change business logic.
It validates approved Workstreams 1-7 behavior only.
*/

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Provider,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { IS_PUBLIC_KEY } from '../../src/auth/auth.constants';
import { AdmissionsService } from '../../src/modules/admissions/application/admissions.service';
import { AdminSupportRedactionService } from '../../src/modules/admin-support/admin-support-redaction.service';
import { BuildMetadataService } from '../../src/modules/health/checks/build-metadata.service';
import { DatabaseHealthCheck } from '../../src/modules/health/checks/database-health.check';
import { RedisHealthCheck } from '../../src/modules/health/checks/redis-health.check';
import { RollbackHealthCheck } from '../../src/modules/health/checks/rollback-health.check';
import { HealthController } from '../../src/modules/health/health.controller';
import { HealthService } from '../../src/modules/health/health.service';
import { PaymentsService } from '../../src/modules/payments/application/payments.service';
import { MtnMomoVerificationAdapter } from '../../src/modules/payments/verification/mtn-momo-verification.adapter';
import { PaystackVerificationAdapter } from '../../src/modules/payments/verification/paystack-verification.adapter';
import { TicketsService } from '../../src/modules/tickets/application/tickets.service';
import { PrismaService } from '../../src/shared/prisma/prisma.service';
import { RedisService } from '../../src/shared/redis/redis.service';
import { createTestApp } from '../setup/test-app.factory';

const SEEDED_SECRETS = {
  databaseUrl: 'postgresql://private-user:private-pass@private-db:5432/govibe',
  redisUrl: 'redis://private-redis:6379',
  paystackBaseUrl: 'https://private-paystack.example',
  momoBaseUrl: 'https://private-momo.example',
  jwtSecret: 'jwt-secret-value-should-not-leak',
  paystackSecret: 'paystack-secret-value-should-not-leak',
  momoSecret: 'momo-secret-value-should-not-leak',
  bearerToken: 'Bearer private-health-token',
  cookie: 'cookie=private-support-cookie',
};

@Injectable()
class RejectUnlessPublicGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    throw new UnauthorizedException('Unauthorized');
  }
}

describe('Workstream 8 health readiness reliability', () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    jest.clearAllMocks();
    envSnapshot = captureEnv([
      'DATABASE_URL',
      'REDIS_URL',
      'PAYSTACK_BASE_URL',
      'MTN_MOMO_BASE_URL',
      'JWT_ACCESS_SECRET',
      'PAYSTACK_SECRET_KEY',
      'MTN_MOMO_API_KEY',
    ]);
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  it('returns 200 liveness during database failure and 503 readiness with not_ready status', async () => {
    seedSecretEnv();
    const app = await createHealthApp({
      prisma: {
        $queryRaw: jest.fn().mockRejectedValue(
          new Error(
            `${SEEDED_SECRETS.databaseUrl} ${SEEDED_SECRETS.paystackSecret}`,
          ),
        ),
      },
    });

    const liveness = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(liveness.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'govibe-api',
        check: 'liveness',
      }),
    );

    const readiness = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(readiness.body.status).toBe('not_ready');
    expect(readiness.body.dependencies.database).toEqual(
      expect.objectContaining({
        status: 'fail',
        required: true,
      }),
    );
    assertNoSecretLeak(readiness.text);

    await app.close();
  });

  it('sanitizes database failure responses and does not expose stack traces', async () => {
    seedSecretEnv();
    const app = await createHealthApp({
      prisma: {
        $queryRaw: jest.fn().mockRejectedValue(
          new Error(
            `db unavailable ${SEEDED_SECRETS.databaseUrl} ${SEEDED_SECRETS.redisUrl} ${SEEDED_SECRETS.bearerToken}`,
          ),
        ),
      },
    });

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(response.body.build).toEqual({
      version: 'unknown',
      commit: 'unknown',
      environment: 'test',
    });
    assertNoSecretLeak(response.text);
    expect(response.text.toLowerCase()).not.toContain('stack');

    await app.close();
  });

  it('skips redis when redis is absent and returns degraded with 200 when optional redis fails', async () => {
    const withoutRedis = await createHealthApp({ provideRedis: false });

    const skipped = await request(withoutRedis.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(skipped.body.status).toBe('ready');
    expect(skipped.body.dependencies.database.status).toBe('ok');
    expect(skipped.body.dependencies.redis).toBeUndefined();

    await withoutRedis.close();

    const redisFailure = await createHealthApp({
      redis: {
        ping: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      },
    });

    const degraded = await request(redisFailure.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(degraded.body.status).toBe('degraded');
    expect(degraded.body.dependencies.database.status).toBe('ok');
    expect(degraded.body.dependencies.redis).toEqual(
      expect.objectContaining({
        status: 'fail',
        required: false,
      }),
    );

    await redisFailure.close();
  });

  it('does not call provider or business services during health requests', async () => {
    const paymentsService = { initiatePayment: jest.fn() };
    const ticketsService = { listMine: jest.fn(), getOwned: jest.fn() };
    const admissionsService = { scanTicket: jest.fn() };
    const paystackVerificationAdapter = { verifyPayment: jest.fn() };
    const momoVerificationAdapter = { verifyPayment: jest.fn() };
    const app = await createHealthApp({
      extraProviders: [
        {
          provide: PaymentsService,
          useValue: paymentsService,
        },
        {
          provide: TicketsService,
          useValue: ticketsService,
        },
        {
          provide: AdmissionsService,
          useValue: admissionsService,
        },
        {
          provide: PaystackVerificationAdapter,
          useValue: paystackVerificationAdapter,
        },
        {
          provide: MtnMomoVerificationAdapter,
          useValue: momoVerificationAdapter,
        },
      ],
    });

    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);

    expect(paymentsService.initiatePayment).not.toHaveBeenCalled();
    expect(ticketsService.listMine).not.toHaveBeenCalled();
    expect(ticketsService.getOwned).not.toHaveBeenCalled();
    expect(admissionsService.scanTicket).not.toHaveBeenCalled();
    expect(paystackVerificationAdapter.verifyPayment).not.toHaveBeenCalled();
    expect(momoVerificationAdapter.verifyPayment).not.toHaveBeenCalled();

    await app.close();
  });

  it('does not leak seeded fake secrets from support-shaped payload redaction', () => {
    const redaction = new AdminSupportRedactionService();

    const redacted = redaction.redactResponse({
      id: 'audit-1',
      safe: 'visible',
      rawPayload: SEEDED_SECRETS.databaseUrl,
      rawHeaders: {
        authorization: SEEDED_SECRETS.bearerToken,
      },
      nested: {
        DATABASE_URL: SEEDED_SECRETS.databaseUrl,
        cookie: SEEDED_SECRETS.cookie,
        note: SEEDED_SECRETS.jwtSecret,
      },
    });

    const text = JSON.stringify(redacted);

    expect(text).toContain('visible');
    assertNoSecretLeak(text);
    expect(text).not.toContain('rawPayload');
    expect(text).not.toContain('rawHeaders');
    expect(text).not.toContain('DATABASE_URL');
  });
});

async function createHealthApp(input?: {
  provideRedis?: boolean;
  prisma?: { $queryRaw: jest.Mock };
  redis?: { ping: jest.Mock };
  extraProviders?: Provider[];
}) {
  const prisma = input?.prisma ?? {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };
  const redis = input?.redis ?? {
    ping: jest.fn().mockResolvedValue('PONG'),
  };

  return createTestApp(
    Test.createTestingModule({
      controllers: [HealthController],
      providers: buildHealthProviders({
        prisma,
        redis,
        provideRedis: input?.provideRedis !== false,
        extraProviders: input?.extraProviders,
      }),
    }),
  );
}

function buildHealthProviders(input: {
  prisma: { $queryRaw: jest.Mock };
  redis: { ping: jest.Mock };
  provideRedis: boolean;
  extraProviders?: Provider[];
}): Provider[] {
  const providers: Provider[] = [
    HealthService,
    DatabaseHealthCheck,
    RedisHealthCheck,
    RollbackHealthCheck,
    BuildMetadataService,
    {
      provide: PrismaService,
      useValue: input.prisma,
    },
    {
      provide: APP_GUARD,
      useClass: RejectUnlessPublicGuard,
    },
    ...(input.extraProviders ?? []),
  ];

  if (input.provideRedis) {
    providers.push({
      provide: RedisService,
      useValue: input.redis,
    });
  }

  return providers;
}

function seedSecretEnv(): void {
  process.env.DATABASE_URL = SEEDED_SECRETS.databaseUrl;
  process.env.REDIS_URL = SEEDED_SECRETS.redisUrl;
  process.env.PAYSTACK_BASE_URL = SEEDED_SECRETS.paystackBaseUrl;
  process.env.MTN_MOMO_BASE_URL = SEEDED_SECRETS.momoBaseUrl;
  process.env.JWT_ACCESS_SECRET = SEEDED_SECRETS.jwtSecret;
  process.env.PAYSTACK_SECRET_KEY = SEEDED_SECRETS.paystackSecret;
  process.env.MTN_MOMO_API_KEY = SEEDED_SECRETS.momoSecret;
}

function assertNoSecretLeak(text: string): void {
  for (const secret of Object.values(SEEDED_SECRETS)) {
    expect(text).not.toContain(secret);
  }
}

function captureEnv(keys: string[]): Record<string, string | undefined> {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}