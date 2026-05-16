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
import { IS_PUBLIC_KEY } from '../../../src/auth/auth.constants';
import { BuildMetadataService } from '../../../src/modules/health/checks/build-metadata.service';
import { DatabaseHealthCheck } from '../../../src/modules/health/checks/database-health.check';
import { RedisHealthCheck } from '../../../src/modules/health/checks/redis-health.check';
import { RollbackHealthCheck } from '../../../src/modules/health/checks/rollback-health.check';
import { HealthController } from '../../../src/modules/health/health.controller';
import { HealthService } from '../../../src/modules/health/health.service';
import { PrismaService } from '../../../src/shared/prisma/prisma.service';
import { RedisService } from '../../../src/shared/redis/redis.service';
import { createTestApp } from '../../setup/test-app.factory';

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

describe('HealthController readiness negative cases', () => {
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

  it('returns actual HTTP 503 with a sanitized not_ready body when the database check fails', async () => {
    process.env.DATABASE_URL = 'postgresql://private-user:private-pass@private-db:5432/govibe';
    process.env.REDIS_URL = 'redis://private-redis:6379';
    process.env.PAYSTACK_BASE_URL = 'https://private-paystack.example';
    process.env.MTN_MOMO_BASE_URL = 'https://private-momo.example';
    process.env.JWT_ACCESS_SECRET = 'jwt-secret-value-should-not-leak';
    process.env.PAYSTACK_SECRET_KEY = 'paystack-secret-value-should-not-leak';
    process.env.MTN_MOMO_API_KEY = 'momo-secret-value-should-not-leak';

    const app = await createHealthApp({
      prisma: {
        $queryRaw: jest.fn().mockRejectedValue(
          new Error(
            'database unavailable postgresql://private-user:private-pass@private-db:5432/govibe PAYSTACK_SECRET_KEY=paystack-secret-value-should-not-leak',
          ),
        ),
      },
    });

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(response.body.status).toBe('not_ready');
    expect(response.body.dependencies.database).toEqual(
      expect.objectContaining({
        status: 'fail',
        required: true,
      }),
    );
    expect(response.body.build).toEqual({
      version: 'unknown',
      commit: 'unknown',
      environment: 'test',
    });
    expect(response.text).not.toContain('postgresql://private-user:private-pass@private-db:5432/govibe');
    expect(response.text).not.toContain('redis://private-redis:6379');
    expect(response.text).not.toContain('https://private-paystack.example');
    expect(response.text).not.toContain('https://private-momo.example');
    expect(response.text).not.toContain('jwt-secret-value-should-not-leak');
    expect(response.text).not.toContain('paystack-secret-value-should-not-leak');
    expect(response.text).not.toContain('momo-secret-value-should-not-leak');
    expect(response.text.toLowerCase()).not.toContain('stack');

    await app.close();
  });
});

async function createHealthApp(input?: {
  prisma?: { $queryRaw: jest.Mock };
  redis?: { ping: jest.Mock };
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
      providers: buildHealthProviders(prisma, redis),
    }),
  );
}

function buildHealthProviders(
  prisma: { $queryRaw: jest.Mock },
  redis: { ping: jest.Mock },
): Provider[] {
  return [
    HealthService,
    DatabaseHealthCheck,
    RedisHealthCheck,
    RollbackHealthCheck,
    BuildMetadataService,
    {
      provide: PrismaService,
      useValue: prisma,
    },
    {
      provide: RedisService,
      useValue: redis,
    },
    {
      provide: APP_GUARD,
      useClass: RejectUnlessPublicGuard,
    },
  ];
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