/*
This is a Workstream 8 reliability validation suite.
It must not add product behavior.
It must not change business logic.
It validates approved Workstreams 1-7 behavior only.
*/

import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  InternalServerErrorException,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import { AppRole } from '../../src/common/constants/roles';
import { AppPermission } from '../../src/common/constants/permissions';
import { AuthUser } from '../../src/common/types/auth-user.type';
import { AdminSupportAuditService } from '../../src/modules/admin-support/admin-support-audit.service';
import { AdminSupportController } from '../../src/modules/admin-support/admin-support.controller';
import { AdminSupportRedactionService } from '../../src/modules/admin-support/admin-support-redaction.service';
import { AdminSupportRepository } from '../../src/modules/admin-support/admin-support.repository';
import { AdminSupportService } from '../../src/modules/admin-support/admin-support.service';
import request = require('supertest');
import {
  AdmissionRejectionReason,
  TicketStatus,
} from '@prisma/client';
import { seedEventInventory } from '../setup/seed-data';
import {
  ContainerRuntimeUnavailableError,
  createWs8TicketsAdmissionsRuntime,
  Ws8TicketsAdmissionsRuntime,
} from '../support/ws8-tickets-admissions-runtime';
import {
  seedIssuedTicket,
  seedPaymentIntentGraph,
} from '../support/ws8-reliability-fixtures';
import { TicketTokenService } from '../../src/modules/tickets/application/ticket-token.service';

const ADMIN_USER_ID = '81000000-0000-4000-8000-000000000099';
const USER_ID = '81000000-0000-4000-8000-000000000001';
const TICKET_ID = '81000000-0000-4000-8000-000000000005';
const ADMISSION_SCAN_ID = '81000000-0000-4000-8000-000000000006';

const fakeSecrets = {
  admissionTokenHash: 'fake-admission-token-secret-value',
  tokenHash: 'fake-scan-token-secret-value',
  scanNonceHash: 'fake-scan-nonce-secret-value',
  rawPayload: 'postgresql://support-user:fake-secret@db/govibe',
  rawHeaders: 'Bearer fake-header-token',
  privateEnv: 'JWT_ACCESS_SECRET=fake-private-secret',
};

class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: AuthUser;
    }>();

    if (!request.headers.authorization) {
      throw new UnauthorizedException('Unauthorized');
    }

    const roleHeader = request.headers['x-test-role'] ?? AppRole.CUSTOMER;
    const role =
      roleHeader === AppRole.ORGANIZER ||
      roleHeader === AppRole.GATE_STAFF ||
      roleHeader === AppRole.ADMIN
        ? roleHeader
        : AppRole.CUSTOMER;

    request.user = {
      id: request.headers['x-test-user-id'] ?? ADMIN_USER_ID,
      email: 'admin-support@govibe.test',
      role,
      sessionId: 'session-1',
      permissions: [] as AppPermission[],
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    return true;
  }
}

describe('Workstream 8 audit fail-closed reliability', () => {
  let runtime: Ws8TicketsAdmissionsRuntime | null = null;
  let ticketTokenService: TicketTokenService;

  beforeAll(async () => {
    try {
      runtime = await createWs8TicketsAdmissionsRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }

    ticketTokenService = new TicketTokenService();
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  beforeEach(async () => {
    jest.restoreAllMocks();

    if (runtime) {
      await runtime.reset();
    }
  });

  it('rolls back ticket issuance when issuance audit persistence fails', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntentGraph(runtime.prisma);
    const original = runtime.ticketRepository.appendIssuanceAudit.bind(
      runtime.ticketRepository,
    );

    jest
      .spyOn(runtime.ticketRepository, 'appendIssuanceAudit')
      .mockImplementation(async (input, tx) => {
        if (input.auditEvent === 'ticket_issued') {
          throw new Error('ticket issuance audit failure');
        }

        await original(input, tx);
      });

    await expect(
      runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      ),
    ).rejects.toThrow('ticket issuance audit failure');

    expect(await runtime.prisma.ticket.count()).toBe(0);
    expect(await runtime.prisma.ticketIssuanceAuditLog.count()).toBe(0);
  });

  it('rolls back an admission scan when audit persistence fails', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedEventInventory(runtime.prisma);
    const issued = await seedIssuedTicket(runtime.prisma, ticketTokenService, {
      ownerUserId: seeded.userId,
      organizerId: seeded.userId,
      eventId: seeded.eventId,
      ticketTypeId: seeded.ticketTypeId,
    });

    jest
      .spyOn(runtime.admissionAuditService, 'record')
      .mockRejectedValueOnce(new Error('admission audit failure'));

    await expect(
      runtime.admissionsService.scanTicket({
        ticketId: issued.ticketId,
        token: issued.token,
        scannedByUserId: seeded.userId,
        eventId: seeded.eventId,
      }),
    ).rejects.toThrow('admission audit failure');

    const ticket = await runtime.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });

    expect(ticket.status).toBe(TicketStatus.ISSUED);
    expect(ticket.usedAt).toBeNull();
    expect(await runtime.prisma.admissionScanAudit.count()).toBe(0);
  });

  it('fails closed on support reads when audit persistence fails and returns no partial data', async () => {
    const { app } = await createAdminSupportApp({
      auditFailure: true,
    });

    const response = await authed(app, AppRole.ADMIN)
      .get('/admin/support/users')
      .expect(500);

    expect(JSON.stringify(response.body)).not.toContain('customer@govibe.test');

    await app.close();
  });

  it('redacts ticket and admission support responses so secrets never leak in the payload', async () => {
    const { app } = await createAdminSupportApp();

    const ticketResponse = await authed(app, AppRole.ADMIN)
      .get(`/admin/support/tickets/${TICKET_ID}`)
      .expect(200);
    const admissionResponse = await authed(app, AppRole.ADMIN)
      .get(`/admin/support/admission-scans/${ADMISSION_SCAN_ID}`)
      .expect(200);

    assertJsonDoesNotContainSecrets(ticketResponse.body);
    assertJsonDoesNotContainSecrets(admissionResponse.body);
    expect(JSON.stringify(ticketResponse.body)).not.toContain('admissionTokenHash');
    expect(JSON.stringify(admissionResponse.body)).not.toContain('tokenHash');
    expect(JSON.stringify(admissionResponse.body)).not.toContain('scanNonceHash');

    await app.close();
  });
});

async function createAdminSupportApp(input?: {
  auditFailure?: boolean;
}): Promise<{ app: INestApplication }> {
  const repository = {
    listUsers: jest.fn().mockResolvedValue({
      items: [
        {
          id: USER_ID,
          email: 'customer@govibe.test',
          role: 'CUSTOMER',
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
      limit: 25,
      offset: 0,
      resultCount: 1,
    }),
    getUserById: jest.fn(),
    listOrganizers: jest.fn(),
    getOrganizerById: jest.fn(),
    listEvents: jest.fn(),
    getEventById: jest.fn(),
    listPayments: jest.fn(),
    getPaymentById: jest.fn(),
    listTickets: jest.fn(),
    getTicketById: jest.fn().mockResolvedValue({
      id: TICKET_ID,
      ticketNumber: 'GV-001',
      ownerUserId: USER_ID,
      eventId: 'event-1',
      organizerId: 'organizer-1',
      paymentIntentId: 'payment-1',
      status: TicketStatus.ISSUED,
      issuedAt: new Date('2026-01-01T00:00:00.000Z'),
      usedAt: null,
      voidedAt: null,
      expiresAt: null,
      admissionTokenHash: fakeSecrets.admissionTokenHash,
    } as never),
    listAdmissionScans: jest.fn(),
    getAdmissionScanById: jest.fn().mockResolvedValue({
      id: ADMISSION_SCAN_ID,
      ticketId: TICKET_ID,
      eventId: 'event-1',
      organizerId: 'organizer-1',
      scannedByUserId: USER_ID,
      status: 'REJECTED',
      rejectionReason: AdmissionRejectionReason.INVALID_TOKEN,
      deviceId: null,
      gateLabel: null,
      scannedAt: new Date('2026-01-02T00:00:00.000Z'),
      tokenHash: fakeSecrets.tokenHash,
      scanNonceHash: fakeSecrets.scanNonceHash,
      rawPayload: fakeSecrets.rawPayload,
      rawHeaders: fakeSecrets.rawHeaders,
      DATABASE_URL: fakeSecrets.privateEnv,
    } as never),
    listAuditLogs: jest.fn(),
    createAuditLog: jest.fn(),
  };
  const auditService = {
    recordRead: input?.auditFailure
      ? jest
          .fn()
          .mockRejectedValue(new InternalServerErrorException('Internal server error'))
      : jest.fn().mockResolvedValue(undefined),
  };

  @Module({
    controllers: [AdminSupportController],
    providers: [
      AdminSupportService,
      AdminSupportRedactionService,
      {
        provide: AdminSupportRepository,
        useValue: repository,
      },
      {
        provide: AdminSupportAuditService,
        useValue: auditService,
      },
    ],
  })
  class AdminSupportTestModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [AdminSupportTestModule],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue(new TestJwtAuthGuard())
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();

  return { app };
}

function authed(app: INestApplication, role: AppRole) {
  const http = request(app.getHttpServer());
  const applyAuth = (test: request.Test) =>
    test
      .set('Authorization', 'Bearer test-token')
      .set('x-test-role', role)
      .set('x-test-user-id', ADMIN_USER_ID);

  return {
    get(path: string) {
      return applyAuth(http.get(path));
    },
  };
}

function assertJsonDoesNotContainSecrets(payload: unknown): void {
  const json = JSON.stringify(payload);

  for (const secret of Object.values(fakeSecrets)) {
    expect(json).not.toContain(secret);
  }
}