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
import { AdmissionsService } from '../../../src/modules/admissions/application/admissions.service';
import { BuildMetadataService } from '../../../src/modules/health/checks/build-metadata.service';
import { DatabaseHealthCheck } from '../../../src/modules/health/checks/database-health.check';
import { RedisHealthCheck } from '../../../src/modules/health/checks/redis-health.check';
import { RollbackHealthCheck } from '../../../src/modules/health/checks/rollback-health.check';
import { HealthController } from '../../../src/modules/health/health.controller';
import { HealthService } from '../../../src/modules/health/health.service';
import { PaymentsService } from '../../../src/modules/payments/application/payments.service';
import { MtnMomoVerificationAdapter } from '../../../src/modules/payments/verification/mtn-momo-verification.adapter';
import { PaystackVerificationAdapter } from '../../../src/modules/payments/verification/paystack-verification.adapter';
import { TicketsService } from '../../../src/modules/tickets/application/tickets.service';
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

describe('health readiness smoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns ready without JWT when database and redis are reachable', async () => {
    const app = await createHealthApp();

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body.status).toBe('ready');
    expect(response.body.service).toBe('govibe-api');
    expect(response.body.check).toBe('readiness');
    expect(response.body.dependencies.database).toEqual(
      expect.objectContaining({
        status: 'ok',
        required: true,
      }),
    );
    expect(response.body.dependencies.redis).toEqual(
      expect.objectContaining({
        status: 'ok',
        required: false,
      }),
    );
    expect(response.body.rollback).toEqual({ status: 'ok' });
    expect(response.body.build).toEqual({
      version: 'unknown',
      commit: 'unknown',
      environment: 'test',
    });

    await app.close();
  });

  it('omits redis when the redis service is not registered', async () => {
    const app = await createHealthApp({ provideRedis: false });

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body.status).toBe('ready');
    expect(response.body.dependencies.database.status).toBe('ok');
    expect(response.body.dependencies.redis).toBeUndefined();

    await app.close();
  });

  it('returns degraded with HTTP 200 when redis fails but database is healthy', async () => {
    const app = await createHealthApp({
      redis: {
        ping: jest.fn().mockRejectedValue(new Error('Redis unavailable')),
      },
    });

    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body.status).toBe('degraded');
    expect(response.body.dependencies.database.status).toBe('ok');
    expect(response.body.dependencies.redis).toEqual(
      expect.objectContaining({
        status: 'fail',
        required: false,
      }),
    );

    await app.close();
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