import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { PaymentProvider } from '@prisma/client';
import request = require('supertest');
import { SessionService } from '../../../src/auth/session.service';
import { AccessTokenStrategy } from '../../../src/auth/strategies/access-token.strategy';
import { JwtAuthGuard } from '../../../src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../src/auth/guards/permissions.guard';
import { AppRole } from '../../../src/common/constants/roles';
import { GetPaymentIntentUseCase } from '../../../src/modules/payments/application/use-cases/get-payment-intent.use-case';
import { InitiatePaymentUseCase } from '../../../src/modules/payments/application/use-cases/initiate-payment.use-case';
import { PaymentsController } from '../../../src/modules/payments/controllers/payments.controller';
import { AppConfigService } from '../../../src/shared/config/config.service';
import { RequestContextService } from '../../../src/shared/context/request-context.service';

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
      id: 'user-1',
      email: 'user@example.com',
      role: AppRole.CUSTOMER,
      sessionId: 'session-1',
      permissions: [],
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    return true;
  }
}

const accessTokenSecret = 'payments-test-access-secret';
const jwtService = new JwtService({ secret: accessTokenSecret });
const paymentIntentResponse = {
  paymentIntentId: '9da88204-4d68-4457-8b03-9518b87b84ea',
  eventId: '2d252bf5-f67b-44a2-9702-7727a4c90f77',
  organizerId: '90301de0-e51f-4df4-bf80-68fa08c0fd05',
  buyerUserId: 'user-1',
  provider: PaymentProvider.PAYSTACK,
  status: 'INITIATED',
  amountMinor: 5000,
  currency: 'GHS',
  providerReference: 'pi_reference_1',
  providerCheckoutUrl: 'https://example.com/pay',
  providerAccessCode: 'access-code-1',
  failureCode: null,
  failureMessage: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  initiatedAt: new Date('2026-01-01T00:00:01.000Z'),
  failedAt: null,
};

describe('PaymentsController (e2e)', () => {
  const initiatePaymentUseCase = {
    execute: jest.fn(),
  };
  const getPaymentIntentUseCase = {
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
    controllers: [PaymentsController],
    providers: [
      {
        provide: InitiatePaymentUseCase,
        useValue: initiatePaymentUseCase,
      },
      {
        provide: GetPaymentIntentUseCase,
        useValue: getPaymentIntentUseCase,
      },
      Reflector,
      PermissionsGuard,
    ],
  })
  class PaymentsTestModule {}

  @Module({
    imports: [PassportModule],
    controllers: [PaymentsController],
    providers: [
      {
        provide: InitiatePaymentUseCase,
        useValue: initiatePaymentUseCase,
      },
      {
        provide: GetPaymentIntentUseCase,
        useValue: getPaymentIntentUseCase,
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
      PermissionsGuard,
      AccessTokenStrategy,
      JwtAuthGuard,
    ],
  })
  class PaymentsSessionAuthTestModule {}

  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    initiatePaymentUseCase.execute.mockResolvedValue(paymentIntentResponse);
    getPaymentIntentUseCase.execute.mockResolvedValue(paymentIntentResponse);

    const moduleRef = await Test.createTestingModule({
      imports: [PaymentsTestModule],
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
      .post('/payments/initiate')
      .send({})
      .expect(401);
  });

  it('rejects missing idempotency headers and unsupported providers', async () => {
    await request(app.getHttpServer())
      .post('/payments/initiate')
      .set('Authorization', 'Bearer test-token')
      .send({
        eventId: '2d252bf5-f67b-44a2-9702-7727a4c90f77',
        provider: 'FLUTTERWAVE',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/payments/initiate')
      .set('Authorization', 'Bearer test-token')
      .send({
        eventId: '2d252bf5-f67b-44a2-9702-7727a4c90f77',
        provider: PaymentProvider.PAYSTACK,
      })
      .expect(400);
  });

  it('creates an initiated payment intent once for a valid request', async () => {
    await request(app.getHttpServer())
      .post('/payments/initiate')
      .set('Authorization', 'Bearer test-token')
      .set('Idempotency-Key', 'payments-key-1234')
      .send({
        eventId: '2d252bf5-f67b-44a2-9702-7727a4c90f77',
        provider: PaymentProvider.PAYSTACK,
        customerPhone: '+233555000111',
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.paymentIntentId).toBe(
          '9da88204-4d68-4457-8b03-9518b87b84ea',
        );
        expect(response.body.eventId).toBe('2d252bf5-f67b-44a2-9702-7727a4c90f77');
        expect(response.body.provider).toBe(PaymentProvider.PAYSTACK);
        expect(response.body.status).toBe('INITIATED');
        expect(response.body.providerCheckoutUrl).toBe('https://example.com/pay');
      });

    expect(initiatePaymentUseCase.execute).toHaveBeenCalledWith({
      idempotencyKey: 'payments-key-1234',
      eventId: '2d252bf5-f67b-44a2-9702-7727a4c90f77',
      provider: PaymentProvider.PAYSTACK,
      customerPhone: '+233555000111',
    });
  });

  it('returns the caller-owned payment intent', async () => {
    await request(app.getHttpServer())
      .get('/payments/9da88204-4d68-4457-8b03-9518b87b84ea')
      .set('Authorization', 'Bearer test-token')
      .expect(200)
      .expect((response) => {
        expect(response.body.paymentIntentId).toBe(
          '9da88204-4d68-4457-8b03-9518b87b84ea',
        );
        expect(response.body.status).toBe('INITIATED');
      });

    expect(getPaymentIntentUseCase.execute).toHaveBeenCalledWith({
      paymentIntentId: '9da88204-4d68-4457-8b03-9518b87b84ea',
      buyerUserId: 'user-1',
    });
  });

  it('rejects a revoked backing session', async () => {
    await app.close();

    sessionService.assertSessionUsable.mockRejectedValueOnce(
      new UnauthorizedException('session revoked'),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [PaymentsSessionAuthTestModule],
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
      .post('/payments/initiate')
      .set('Authorization', `Bearer ${signAccessToken('session-revoked')}`)
      .set('Idempotency-Key', 'payments-auth-revoked')
      .send({
        eventId: '2d252bf5-f67b-44a2-9702-7727a4c90f77',
        provider: PaymentProvider.PAYSTACK,
      })
      .expect(401);

    expect(initiatePaymentUseCase.execute).not.toHaveBeenCalled();
  });

  it('rejects an inactive user from the backing session', async () => {
    await app.close();

    sessionService.assertSessionUsable.mockRejectedValueOnce(
      new UnauthorizedException('user inactive'),
    );

    const moduleRef = await Test.createTestingModule({
      imports: [PaymentsSessionAuthTestModule],
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
      .post('/payments/initiate')
      .set('Authorization', `Bearer ${signAccessToken('session-inactive')}`)
      .set('Idempotency-Key', 'payments-auth-inactive')
      .send({
        eventId: '2d252bf5-f67b-44a2-9702-7727a4c90f77',
        provider: PaymentProvider.PAYSTACK,
      })
      .expect(401);

    expect(initiatePaymentUseCase.execute).not.toHaveBeenCalled();
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
