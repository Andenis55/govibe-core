import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard';
import { AppRole } from '../../../src/common/constants/roles';
import { AppConfigService } from '../../../src/shared/config/config.service';
import { RequestContextService } from '../../../src/shared/context/request-context.service';
import { SessionService } from '../../../src/auth/session.service';
import { AccessTokenStrategy } from '../../../src/auth/strategies/access-token.strategy';
import { CheckoutController } from '../../../src/modules/orders/controllers/checkout.controller';
import { CreateOrderUseCase } from '../../../src/modules/orders/application/use-cases/create-order.use-case';

class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: Record<string, unknown>;
    }>();

    if (!request.headers.authorization) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    request.user = {
      userId: 'user-1',
      email: 'user@example.com',
      roles: [],
      permissions: [],
    };

    return true;
  }
}

const accessTokenSecret = 'checkout-test-access-secret';
const jwtService = new JwtService({ secret: accessTokenSecret });

describe('CheckoutController (e2e)', () => {
  const createOrderUseCase = {
    execute: jest.fn(),
  };
  const sessionService = {
    assertSessionUsable: jest.fn(),
  };
  const appConfigService = {
    getOrThrow: jest.fn((key: string) => {
      if (key === 'JWT_ACCESS_SECRET') {
        return accessTokenSecret;
      }

      throw new Error(`Unexpected config lookup: ${key}`);
    }),
  };

  @Module({
    controllers: [CheckoutController],
    providers: [
      {
        provide: CreateOrderUseCase,
        useValue: createOrderUseCase,
      },
    ],
  })
  class CheckoutTestModule {}

  @Module({
    imports: [PassportModule],
    controllers: [CheckoutController],
    providers: [
      {
        provide: CreateOrderUseCase,
        useValue: createOrderUseCase,
      },
      {
        provide: SessionService,
        useValue: sessionService,
      },
      {
        provide: AppConfigService,
        useValue: appConfigService,
      },
      RequestContextService,
      Reflector,
      AccessTokenStrategy,
      JwtAuthGuard,
    ],
  })
  class CheckoutSessionAuthTestModule {}

  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    createOrderUseCase.execute.mockResolvedValue({
      orderId: 'c0c75995-d268-4781-a3e2-c5cbb58d8a06',
      status: 'RESERVED',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [CheckoutTestModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(new TestJwtAuthGuard())
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post('/checkout/order')
      .send({})
      .expect(401);
  });

  it('rejects invalid payloads and missing idempotency headers', async () => {
    await request(app.getHttpServer())
      .post('/checkout/order')
      .set('Authorization', 'Bearer test-token')
      .send({
        reservationId: 'not-a-uuid',
        totalAmountMinor: '1500',
        currency: 'USD',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/checkout/order')
      .set('Authorization', 'Bearer test-token')
      .send({
        reservationId: '0c28cc0a-6448-45a6-b966-bf6ff247ce17',
        totalAmountMinor: '1500',
        currency: 'GHS',
      })
      .expect(400);
  });

  it('creates an order for a valid request', async () => {
    await request(app.getHttpServer())
      .post('/checkout/order')
      .set('Authorization', 'Bearer test-token')
      .set('Idempotency-Key', 'checkout-key-1234')
      .send({
        reservationId: '0c28cc0a-6448-45a6-b966-bf6ff247ce17',
        totalAmountMinor: '1500',
        currency: 'GHS',
      })
      .expect(201)
      .expect({
        orderId: 'c0c75995-d268-4781-a3e2-c5cbb58d8a06',
        status: 'RESERVED',
      });
  });

  it('rejects a revoked backing session', async () => {
    await app.close();

    sessionService.assertSessionUsable.mockRejectedValueOnce(
      new UnauthorizedException('session revoked'),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [CheckoutSessionAuthTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    await request(app.getHttpServer())
      .post('/checkout/order')
      .set('Authorization', `Bearer ${signAccessToken('session-revoked')}`)
      .set('Idempotency-Key', 'checkout-auth-revoked')
      .send({
        reservationId: '0c28cc0a-6448-45a6-b966-bf6ff247ce17',
        totalAmountMinor: '1500',
        currency: 'GHS',
      })
      .expect(401);

    expect(createOrderUseCase.execute).not.toHaveBeenCalled();
  });

  it('rejects an inactive user from the backing session', async () => {
    await app.close();

    sessionService.assertSessionUsable.mockRejectedValueOnce(
      new UnauthorizedException('user inactive'),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [CheckoutSessionAuthTestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();

    await request(app.getHttpServer())
      .post('/checkout/order')
      .set('Authorization', `Bearer ${signAccessToken('session-inactive')}`)
      .set('Idempotency-Key', 'checkout-auth-inactive')
      .send({
        reservationId: '0c28cc0a-6448-45a6-b966-bf6ff247ce17',
        totalAmountMinor: '1500',
        currency: 'GHS',
      })
      .expect(401);

    expect(createOrderUseCase.execute).not.toHaveBeenCalled();
  });
});

function signAccessToken(sessionId: string): string {
  return jwtService.sign({
    sub: 'user-1',
    email: 'user@example.com',
    role: AppRole.CUSTOMER,
    sessionId,
    jti: `jti-${sessionId}`,
    type: 'access',
  });
}