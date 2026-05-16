import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { AdmissionsService } from '../../../src/modules/admissions/application/admissions.service';
import { AdmissionsController } from '../../../src/modules/admissions/controllers/admissions.controller';
import { JwtAuthGuard } from '../../../src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../src/auth/guards/permissions.guard';
import { AppRole } from '../../../src/common/constants/roles';

class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: Record<string, unknown>;
    }>();

    if (!request.headers.authorization) {
      throw new UnauthorizedException('Authenticated user required.');
    }

    const roleHeader = request.headers['x-test-role'] ?? AppRole.CUSTOMER;
    const role =
      roleHeader === AppRole.ORGANIZER ||
      roleHeader === AppRole.GATE_STAFF ||
      roleHeader === AppRole.ADMIN
        ? roleHeader
        : AppRole.CUSTOMER;

    request.user = {
      id: request.headers['x-test-user-id'] ?? 'scanner-1',
      email: 'scanner@example.com',
      role,
      sessionId: 'session-1',
      permissions: [],
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    return true;
  }
}

describe('AdmissionsController (e2e)', () => {
  const admissionsService = {
    scanTicket: jest.fn(),
  };

  @Module({
    controllers: [AdmissionsController],
    providers: [
      {
        provide: AdmissionsService,
        useValue: admissionsService,
      },
      PermissionsGuard,
    ],
  })
  class AdmissionsTestModule {}

  let app: INestApplication;

  beforeEach(async () => {
    jest.clearAllMocks();
    admissionsService.scanTicket.mockResolvedValue({
      accepted: true,
      status: 'ACCEPTED',
      rejectionReason: null,
      ticketId: 'ticket-1',
      scannedAt: '2026-01-01T00:00:00.000Z',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AdmissionsTestModule],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(new TestJwtAuthGuard())
      .overrideGuard(PermissionsGuard)
      .useValue({
        canActivate(context: ExecutionContext): boolean {
          const request = context.switchToHttp().getRequest<{
            user?: { role?: string };
          }>();

          if (request.user?.role !== AppRole.ORGANIZER) {
            throw new ForbiddenException('Missing required permissions.');
          }

          return true;
        },
      })
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

  it('requires the admissions:scan permission', async () => {
    await request(app.getHttpServer())
      .post('/admissions/scan')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', AppRole.CUSTOMER)
      .send({
        ticketId: '48e64e1a-2c2c-456a-a399-f08d00a3a663',
        token: 'x'.repeat(64),
      })
      .expect(403);
  });

  it('rejects invalid bodies', async () => {
    await request(app.getHttpServer())
      .post('/admissions/scan')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', AppRole.ORGANIZER)
      .send({
        ticketId: 'not-a-uuid',
        token: 'short',
      })
      .expect(400);
  });

  it('returns a successful validation result for a permitted request', async () => {
    await request(app.getHttpServer())
      .post('/admissions/scan')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', AppRole.ORGANIZER)
      .set('x-test-user-id', 'organizer-owner-1')
      .send({
        ticketId: '48e64e1a-2c2c-456a-a399-f08d00a3a663',
        token: 'x'.repeat(64),
        gateLabel: 'north-gate',
      })
      .expect(200)
      .expect({
        accepted: true,
        status: 'ACCEPTED',
        rejectionReason: null,
        ticketId: 'ticket-1',
        scannedAt: '2026-01-01T00:00:00.000Z',
      });

    expect(admissionsService.scanTicket).toHaveBeenCalledWith({
      ticketId: '48e64e1a-2c2c-456a-a399-f08d00a3a663',
      token: 'x'.repeat(64),
      scannedByUserId: 'organizer-owner-1',
      eventId: null,
      deviceId: null,
      gateLabel: 'north-gate',
    });
  });
});