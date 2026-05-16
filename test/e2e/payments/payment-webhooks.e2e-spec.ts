import {
  Body,
  Controller,
  Injectable,
  INestApplication,
  MiddlewareConsumer,
  NestMiddleware,
  Module,
  NestModule,
  Post,
  Req,
  RequestMethod,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { Public } from '../../../src/auth/decorators/public.decorator';
import { JwtAuthGuard } from '../../../src/auth/guards/jwt-auth.guard';
import { RequestContextService } from '../../../src/shared/context/request-context.service';

type RawBodyRequest = {
  rawBody?: Buffer;
  body?: Record<string, unknown>;
};

@Injectable()
class SmokeRawBodyMiddleware implements NestMiddleware {
  use(req: RawBodyRequest & NodeJS.ReadableStream, _res: unknown, next: () => void): void {
    const chunks: Buffer[] = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      req.rawBody = rawBody;

      try {
        req.body = rawBody.length > 0
          ? (JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>)
          : {};
      } catch {
        req.body = {};
      }

      next();
    });
  }
};

@Controller('payments/webhooks')
@UseGuards(JwtAuthGuard)
class WebhookSmokeController {
  @Public()
  @Post('paystack')
  handlePaystack(
    @Body() body: Record<string, unknown>,
    @Req() request: RawBodyRequest,
  ) {
    return {
      acknowledged: true,
      rawBody: request.rawBody?.toString('utf8') ?? null,
      body,
    };
  }

  @Public()
  @Post('mtn-momo')
  handleMtnMomo(@Req() request: RawBodyRequest) {
    return {
      acknowledged: true,
      rawBodyPresent: Boolean(request.rawBody),
    };
  }
}

describe('Payment webhook route smoke (e2e)', () => {
  @Module({
    controllers: [WebhookSmokeController],
    providers: [Reflector, RequestContextService, JwtAuthGuard],
  })
  class PaymentWebhookSmokeModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
      consumer.apply(SmokeRawBodyMiddleware).forRoutes({
        path: '*',
        method: RequestMethod.ALL,
      });
    }
  }

  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PaymentWebhookSmokeModule],
    }).compile();

    app = moduleRef.createNestApplication({ bodyParser: false });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('preserves the exact raw body for Paystack webhook processing', async () => {
    const rawBody = '{"data":{"reference":"provider-ref-1","status":"success","amount":5000,"currency":"GHS"}}';

    const response = await request(app.getHttpServer())
      .post('/payments/webhooks/paystack')
      .set('Content-Type', 'application/json')
      .send(rawBody)
      .expect(201);

    expect(response.body.rawBody).toBe(rawBody);
  });

  it('keeps webhook routes publicly reachable without JWT headers', async () => {
    const response = await request(app.getHttpServer())
      .post('/payments/webhooks/mtn-momo')
      .set('Content-Type', 'application/json')
      .send('{"referenceId":"provider-ref-2","status":"PENDING"}')
      .expect(201);

    expect(response.body.acknowledged).toBe(true);
    expect(response.body.rawBodyPresent).toBe(true);
  });
});