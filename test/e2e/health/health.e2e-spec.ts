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

describe('HealthController (e2e)', () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    jest.clearAllMocks();
    envSnapshot = captureEnv([
      'APP_VERSION',
      'APP_COMMIT',
      'NODE_ENV',
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

  it('marks health endpoints public using the existing public metadata key', () => {
    expect(getPublicMetadata('getLiveness')).toBe(true);
    expect(getPublicMetadata('getReadiness')).toBe(true);
    expect(getPublicMetadata('getSummary')).toBe(true);
  });

  it('serves public liveness without touching database or redis checks', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const redis = {
      ping: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    };
    const app = await createHealthApp({ prisma, redis });

    const response = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'govibe-api',
        check: 'liveness',
      }),
    );
    expect(typeof response.body.timestamp).toBe('string');
    expect(typeof response.body.uptimeSeconds).toBe('number');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns safe summary data only and defaults missing build metadata to unknown', async () => {
    delete process.env.APP_VERSION;
    delete process.env.APP_COMMIT;
    process.env.NODE_ENV = '   ';
    process.env.DATABASE_URL = 'postgresql://secret-user:secret-pass@private-host:5432/govibe';
    process.env.REDIS_URL = 'redis://private-redis-host:6379';
    process.env.PAYSTACK_BASE_URL = 'https://private-paystack.example';
    process.env.MTN_MOMO_BASE_URL = 'https://private-momo.example';
    process.env.JWT_ACCESS_SECRET = 'jwt-secret-value-should-not-leak';
    process.env.PAYSTACK_SECRET_KEY = 'paystack-secret-value-should-not-leak';
    process.env.MTN_MOMO_API_KEY = 'momo-secret-value-should-not-leak';

    const app = await createHealthApp();

    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        service: 'govibe-api',
        check: 'summary',
        build: {
          version: 'unknown',
          commit: 'unknown',
          environment: 'unknown',
        },
      }),
    );
    expect(Object.keys(response.body).sort()).toEqual([
      'build',
      'check',
      'service',
      'status',
      'timestamp',
      'uptimeSeconds',
    ]);
    expect(response.body.dependencies).toBeUndefined();
    expect(response.body.rollback).toBeUndefined();
    expect(response.text).not.toContain('postgresql://secret-user:secret-pass@private-host:5432/govibe');
    expect(response.text).not.toContain('redis://private-redis-host:6379');
    expect(response.text).not.toContain('https://private-paystack.example');
    expect(response.text).not.toContain('https://private-momo.example');
    expect(response.text).not.toContain('jwt-secret-value-should-not-leak');
    expect(response.text).not.toContain('paystack-secret-value-should-not-leak');
    expect(response.text).not.toContain('momo-secret-value-should-not-leak');

    await app.close();
  });

  it('trims build metadata to the approved maximum lengths', async () => {
    process.env.APP_VERSION = `  ${'v'.repeat(90)}  `;
    process.env.APP_COMMIT = `  ${'c'.repeat(90)}  `;
    process.env.NODE_ENV = `  ${'p'.repeat(50)}  `;

    const app = await createHealthApp();

    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body.build.version).toBe('v'.repeat(80));
    expect(response.body.build.commit).toBe('c'.repeat(80));
    expect(response.body.build.environment).toBe('p'.repeat(40));

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

function getPublicMetadata(methodName: keyof HealthController): boolean | undefined {
  return Reflect.getMetadata(IS_PUBLIC_KEY, HealthController.prototype[methodName]);
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