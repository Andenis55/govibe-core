import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  InternalServerErrorException,
  INestApplication,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminActionStatus, EventCategory, EventStatus, EventVisibility, OrganizerStatus, PaymentIntentStatus, PaymentProvider, TicketStatus, UserRole } from '@prisma/client';
import request = require('supertest');
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../src/auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../src/auth/auth.constants';
import { ROLE_PERMISSIONS } from '../src/auth/auth.types';
import { AppPermission } from '../src/common/constants/permissions';
import { AppRole } from '../src/common/constants/roles';
import { AdminSupportAuditService } from '../src/modules/admin-support/admin-support-audit.service';
import { AdminSupportController } from '../src/modules/admin-support/admin-support.controller';
import { AdminSupportRedactionService } from '../src/modules/admin-support/admin-support-redaction.service';
import {
  AdminSupportRepository,
  CreateAdminSupportAuditLogInput,
} from '../src/modules/admin-support/admin-support.repository';
import { AdminSupportService } from '../src/modules/admin-support/admin-support.service';
import { AdminLookupQueryDto } from '../src/modules/admin-support/dto/admin-lookup-query.dto';

const ADMIN_USER_ID = '81000000-0000-4000-8000-000000000099';
const USER_ID = '81000000-0000-4000-8000-000000000001';
const ORGANIZER_ID = '81000000-0000-4000-8000-000000000002';
const EVENT_ID = '81000000-0000-4000-8000-000000000003';
const PAYMENT_ID = '81000000-0000-4000-8000-000000000004';
const TICKET_ID = '81000000-0000-4000-8000-000000000005';
const ADMISSION_SCAN_ID = '81000000-0000-4000-8000-000000000006';
const AUDIT_LOG_ID = '81000000-0000-4000-8000-000000000007';

const fakeSecrets = {
  passwordHash: 'fake-password-secret-value',
  refreshTokenHash: 'fake-refresh-token-secret-value',
  previousRefreshTokenHash: 'fake-previous-refresh-secret-value',
  sessionTokenHash: 'fake-session-token-secret-value',
  providerRawResponse: 'fake-provider-raw-secret-value',
  providerVerificationRaw: 'fake-provider-verification-secret-value',
  providerCheckoutUrl: 'https://payments.test/checkout?token=fake-secret-token',
  providerAccessCode: 'fake-provider-access-code-secret',
  admissionTokenHash: 'fake-admission-token-secret-value',
  tokenHash: 'fake-scan-token-secret-value',
  scanNonceHash: 'fake-scan-nonce-secret-value',
  rawPayload: 'postgresql://support-user:fake-secret@db/govibe',
  rawHeaders: 'Bearer fake-header-token',
  privateEnv: 'JWT_ACCESS_SECRET=fake-private-secret',
  cookie: 'cookie=fake-secret-cookie',
};

class TestJwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: Record<string, unknown>;
    }>();

    if (!request.headers.authorization) {
      throw new UnauthorizedException('Unauthorized');
    }

    const roleHeader = request.headers['x-test-role'];
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
      permissions: [],
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    return true;
  }
}

describe('Workstream 7 admin support', () => {
  describe('permission surface', () => {
    it('keeps SUPPORT absent, grants audit-log read to ADMIN only, and does not add forbidden manage status permission', () => {
      expect(Object.values(AppRole)).not.toContain('SUPPORT');
      expect((ROLE_PERMISSIONS as Record<string, AppPermission[]>).SUPPORT).toBeUndefined();
      expect(ROLE_PERMISSIONS[AppRole.ADMIN]).toContain(
        AppPermission.ADMIN_SUPPORT_READ_AUDIT_LOGS,
      );

      for (const role of Object.values(AppRole)) {
        if (role === AppRole.ADMIN) {
          continue;
        }

        expect(ROLE_PERMISSIONS[role]).not.toContain(
          AppPermission.ADMIN_SUPPORT_READ_AUDIT_LOGS,
        );
      }

      expect(
        Object.prototype.hasOwnProperty.call(
          AppPermission,
          'ADMIN_SUPPORT_MANAGE_ORGANIZER_STATUS',
        ),
      ).toBe(false);
    });

    it('uses the exact ADMIN_SUPPORT_* permission mapping on each controller route', () => {
      const cases = [
        ['listUsers', AppPermission.ADMIN_SUPPORT_READ_USERS],
        ['getUser', AppPermission.ADMIN_SUPPORT_READ_USERS],
        ['listOrganizers', AppPermission.ADMIN_SUPPORT_READ_ORGANIZERS],
        ['getOrganizer', AppPermission.ADMIN_SUPPORT_READ_ORGANIZERS],
        ['listEvents', AppPermission.ADMIN_SUPPORT_READ_EVENTS],
        ['getEvent', AppPermission.ADMIN_SUPPORT_READ_EVENTS],
        ['listPayments', AppPermission.ADMIN_SUPPORT_READ_PAYMENTS],
        ['getPayment', AppPermission.ADMIN_SUPPORT_READ_PAYMENTS],
        ['listTickets', AppPermission.ADMIN_SUPPORT_READ_TICKETS],
        ['getTicket', AppPermission.ADMIN_SUPPORT_READ_TICKETS],
        ['listAdmissionScans', AppPermission.ADMIN_SUPPORT_READ_ADMISSIONS],
        ['getAdmissionScan', AppPermission.ADMIN_SUPPORT_READ_ADMISSIONS],
        ['listAuditLogs', AppPermission.ADMIN_SUPPORT_READ_AUDIT_LOGS],
      ] as const;

      for (const [methodName, expectedPermission] of cases) {
        expect(
          Reflect.getMetadata(
            PERMISSIONS_KEY,
            AdminSupportController.prototype[methodName],
          ),
        ).toEqual([expectedPermission]);
      }
    });
  });

  describe('redaction service', () => {
    it('redacts forbidden keys, removes forbidden key names, and strips high-risk string fragments deterministically', () => {
      const redaction = new AdminSupportRedactionService();

      const result = redaction.redactResponse({
        ok: 'visible',
        passwordHash: fakeSecrets.passwordHash,
        nested: {
          Authorization: fakeSecrets.rawHeaders,
          someValue: fakeSecrets.privateEnv,
          harmless: 'keep-me',
        },
        apiKeyHint: 'should disappear',
        note: `please rotate ${fakeSecrets.providerAccessCode}`,
      });
      const json = JSON.stringify(result);

      expect(json).toContain('visible');
      expect(json).toContain('keep-me');
      expect(json).toContain('[REDACTED]');
      expect(json).not.toContain('passwordHash');
      expect(json).not.toContain('Authorization');
      expect(json).not.toContain('apiKeyHint');
      expect(json).not.toContain(fakeSecrets.passwordHash);
      expect(json).not.toContain(fakeSecrets.rawHeaders);
      expect(json).not.toContain(fakeSecrets.privateEnv);
      expect(json).not.toContain(fakeSecrets.providerAccessCode);
    });
  });

  describe('audit service', () => {
    it('writes SUPPORT_READ with SUCCEEDED status and redacted metadata', async () => {
      const repository = {
        createAuditLog: jest.fn().mockResolvedValue(undefined),
      } as unknown as AdminSupportRepository;
      const redaction = new AdminSupportRedactionService();
      const service = new AdminSupportAuditService(repository, redaction);

      await service.recordRead({
        actorUserId: ADMIN_USER_ID,
        action: 'admin_support_read_audit_log',
        targetType: 'admin_support_audit_log',
        metadata: {
          route: 'GET /admin/support/audit-logs',
          filters: {
            search: fakeSecrets.rawPayload,
          },
          safeFilterNames: ['search'],
          rawHeaders: fakeSecrets.rawHeaders,
        },
      });

      expect(repository.createAuditLog).toHaveBeenCalledTimes(1);

      const payload = (repository.createAuditLog as jest.Mock).mock
        .calls[0][0] as CreateAdminSupportAuditLogInput;
      const metadata = payload.metadata as Record<string, unknown>;
      const json = JSON.stringify(metadata);

      expect(payload.status).toBe(AdminActionStatus.SUCCEEDED);
      expect(payload.reasonCode).toBe('SUPPORT_READ');
      expect(payload.action).toBe('admin_support_read_audit_log');
      expect(json).toContain('[REDACTED]');
      expect(json).not.toContain(fakeSecrets.rawPayload);
      expect(json).not.toContain(fakeSecrets.rawHeaders);
      expect(json).not.toContain('rawHeaders');
    });

    it('throws internal server error when audit persistence fails', async () => {
      const repository = {
        createAuditLog: jest.fn().mockRejectedValue(new Error('boom')),
      } as unknown as AdminSupportRepository;
      const redaction = new AdminSupportRedactionService();
      const service = new AdminSupportAuditService(repository, redaction);

      await expect(
        service.recordRead({
          actorUserId: ADMIN_USER_ID,
          action: 'admin_support_read_user',
          targetType: 'user',
          metadata: {
            route: 'GET /admin/support/users',
          },
        }),
      ).rejects.toThrow('Internal server error');
    });
  });

  describe('repository explicit select and search surface', () => {
    it('uses support-safe explicit selects and excludes forbidden fields from search clauses', async () => {
      const prisma = {
        user: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        paymentIntent: {
          findUnique: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        ticket: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        admissionScanAudit: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      } as any;
      const repository = new AdminSupportRepository(prisma);
      const query = new AdminLookupQueryDto();

      query.search = 'search-me';

      await repository.getUserById(USER_ID);
      await repository.getPaymentById(PAYMENT_ID);
      await repository.getTicketById(TICKET_ID);
      await repository.getAdmissionScanById(ADMISSION_SCAN_ID);
      await repository.listPayments(query);

      const userSelect = prisma.user.findUnique.mock.calls[0][0].select as Record<
        string,
        unknown
      >;
      const paymentSelect = prisma.paymentIntent.findUnique.mock.calls[0][0]
        .select as Record<string, unknown>;
      const ticketSelect = prisma.ticket.findUnique.mock.calls[0][0]
        .select as Record<string, unknown>;
      const admissionSelect = prisma.admissionScanAudit.findUnique.mock.calls[0][0]
        .select as Record<string, unknown>;
      const paymentWhere = prisma.paymentIntent.findMany.mock.calls[0][0].where;
      const paymentWhereJson = JSON.stringify(paymentWhere);

      expect(userSelect).not.toHaveProperty('passwordHash');
      expect(userSelect).not.toHaveProperty('refreshTokenHash');
      expect(userSelect).not.toHaveProperty('previousRefreshTokenHash');
      expect(userSelect).not.toHaveProperty('sessionTokenHash');
      expect(paymentSelect).not.toHaveProperty('providerRawResponse');
      expect(paymentSelect).not.toHaveProperty('providerVerificationRaw');
      expect(paymentSelect).not.toHaveProperty('providerCheckoutUrl');
      expect(paymentSelect).not.toHaveProperty('providerAccessCode');
      expect(ticketSelect).not.toHaveProperty('admissionTokenHash');
      expect(admissionSelect).not.toHaveProperty('tokenHash');
      expect(admissionSelect).not.toHaveProperty('scanNonceHash');
      expect(paymentWhereJson).not.toContain('providerRawResponse');
      expect(paymentWhereJson).not.toContain('providerVerificationRaw');
      expect(paymentWhereJson).not.toContain('rawPayload');
      expect(paymentWhereJson).not.toContain('rawHeaders');
      expect(paymentWhereJson).not.toContain('verifiedPayload');
    });
  });

  describe('controller integration', () => {
    const repository = {
      listUsers: jest.fn(),
      getUserById: jest.fn(),
      listOrganizers: jest.fn(),
      getOrganizerById: jest.fn(),
      listEvents: jest.fn(),
      getEventById: jest.fn(),
      listPayments: jest.fn(),
      getPaymentById: jest.fn(),
      listTickets: jest.fn(),
      getTicketById: jest.fn(),
      listAdmissionScans: jest.fn(),
      getAdmissionScanById: jest.fn(),
      listAuditLogs: jest.fn(),
      createAuditLog: jest.fn(),
      updatePaymentState: jest.fn(),
      issueTickets: jest.fn(),
      grantAdmissions: jest.fn(),
      mutateAdmissionState: jest.fn(),
    };
    const auditService = {
      recordRead: jest.fn(),
    };
    const providerBoundarySpies = {
      initiatePayment: jest.fn(),
      verifyPayment: jest.fn(),
    };

    @Module({
      controllers: [AdminSupportController],
      providers: [
        AdminSupportService,
        AdminSupportRedactionService,
        PermissionsGuard,
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

    let app: INestApplication;

    beforeEach(async () => {
      jest.clearAllMocks();
      repository.listUsers.mockResolvedValue(createListResult([buildUserRecord()]));
      repository.getUserById.mockResolvedValue(buildUserRecord());
      repository.listOrganizers.mockResolvedValue(
        createListResult([buildOrganizerRecord()]),
      );
      repository.getOrganizerById.mockResolvedValue(buildOrganizerRecord());
      repository.listEvents.mockResolvedValue(createListResult([buildEventRecord()]));
      repository.getEventById.mockResolvedValue(buildEventRecord());
      repository.listPayments.mockResolvedValue(
        createListResult([buildPaymentRecord()]),
      );
      repository.getPaymentById.mockResolvedValue(buildPaymentRecord());
      repository.listTickets.mockResolvedValue(createListResult([buildTicketRecord()]));
      repository.getTicketById.mockResolvedValue(buildTicketRecord());
      repository.listAdmissionScans.mockResolvedValue(
        createListResult([buildAdmissionScanRecord()]),
      );
      repository.getAdmissionScanById.mockResolvedValue(
        buildAdmissionScanRecord(),
      );
      repository.listAuditLogs.mockResolvedValue(
        createListResult([buildAuditLogRecord()]),
      );
      auditService.recordRead.mockResolvedValue(undefined);

      const moduleRef = await Test.createTestingModule({
        imports: [AdminSupportTestModule],
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

    it('rejects unauthenticated requests to admin/support routes', async () => {
      await request(app.getHttpServer()).get('/admin/support/users').expect(401);
    });

    it('rejects customer and organizer access to admin/support routes and audit logs', async () => {
      await authed(app, AppRole.CUSTOMER)
        .get('/admin/support/users')
        .expect(403);

      await authed(app, AppRole.ORGANIZER)
        .get('/admin/support/audit-logs')
        .expect(403);
    });

    it('allows admin read-only access and audits audit-log reads with minimal metadata', async () => {
      repository.listAuditLogs.mockResolvedValueOnce({
        items: [buildAuditLogRecord()],
        limit: 2,
        offset: 1,
        resultCount: 1,
      });

      const response = await authed(app, AppRole.ADMIN)
        .get('/admin/support/audit-logs?search=   audit   &limit=2&offset=1')
        .expect(200);

      expect(response.body.limit).toBe(2);
      expect(response.body.offset).toBe(1);
      expect(response.body.resultCount).toBe(1);
      expect(response.body.items).toHaveLength(1);
      expect(auditService.recordRead).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUserId: ADMIN_USER_ID,
          action: 'admin_support_read_audit_log',
          targetType: 'admin_support_audit_log',
        }),
      );

      const metadata = auditService.recordRead.mock.calls[0][0]
        .metadata as Record<string, unknown>;
      const json = JSON.stringify(metadata);

      expect(metadata).toMatchObject({
        route: 'GET /admin/support/audit-logs',
        routeAction: 'admin_support_read_audit_log',
        limit: 2,
        offset: 1,
        resultCount: 1,
        targetType: 'admin_support_audit_log',
        safeFilterNames: ['search'],
      });
      expect(json).not.toContain('items');
      expect(json).not.toContain('customer@govibe.test');
      expect(json).not.toContain(fakeSecrets.rawPayload);
    });

    it('fails closed on audit-log reads when audit persistence fails', async () => {
      auditService.recordRead.mockRejectedValueOnce(
        new InternalServerErrorException('Internal server error'),
      );

      const response = await authed(app, AppRole.ADMIN)
        .get('/admin/support/audit-logs')
        .expect(500);

      const json = JSON.stringify(response.body);

      expect(json).not.toContain(AUDIT_LOG_ID);
      expect(json).not.toContain(fakeSecrets.rawPayload);
    });

    it('lists users with default pagination and writes support read audit entries', async () => {
      const response = await authed(app, AppRole.ADMIN)
        .get('/admin/support/users')
        .expect(200);

      expect(repository.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 25, offset: 0, search: undefined }),
      );
      expect(response.body.limit).toBe(25);
      expect(response.body.offset).toBe(0);
      expect(auditService.recordRead).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_support_read_user',
          targetType: 'user',
        }),
      );
    });

    it('supports bounded pagination and rejects invalid lookup query values', async () => {
      await authed(app, AppRole.ADMIN)
        .get('/admin/support/users?limit=2&offset=1&search=%20customer%20')
        .expect(200);

      expect(repository.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 2, offset: 1, search: 'customer' }),
      );

      await authed(app, AppRole.ADMIN)
        .get('/admin/support/users?limit=101')
        .expect(400);

      await authed(app, AppRole.ADMIN)
        .get(`/admin/support/users?search=${'a'.repeat(121)}`)
        .expect(400);
    });

    it('returns 404 when a detail target is missing', async () => {
      repository.getUserById.mockResolvedValueOnce(null);

      await authed(app, AppRole.ADMIN)
        .get(`/admin/support/users/${USER_ID}`)
        .expect(404);
    });

    it('does not expose forbidden user fields or token hashes in user responses', async () => {
      repository.getUserById.mockResolvedValueOnce({
        ...buildUserRecord(),
        passwordHash: fakeSecrets.passwordHash,
        refreshTokenHash: fakeSecrets.refreshTokenHash,
        previousRefreshTokenHash: fakeSecrets.previousRefreshTokenHash,
        sessionTokenHash: fakeSecrets.sessionTokenHash,
      } as any);

      const response = await authed(app, AppRole.ADMIN)
        .get(`/admin/support/users/${USER_ID}`)
        .expect(200);

      assertJsonDoesNotContainSecrets(response.body);
      expect(JSON.stringify(response.body)).not.toContain('passwordHash');
      expect(JSON.stringify(response.body)).not.toContain('refreshTokenHash');
      expect(JSON.stringify(response.body)).not.toContain('sessionTokenHash');
    });

    it('does not expose forbidden payment fields, raw payloads, or private env values in payment responses', async () => {
      repository.getPaymentById.mockResolvedValueOnce({
        ...buildPaymentRecord(),
        providerRawResponse: fakeSecrets.providerRawResponse,
        providerVerificationRaw: fakeSecrets.providerVerificationRaw,
        providerCheckoutUrl: fakeSecrets.providerCheckoutUrl,
        providerAccessCode: fakeSecrets.providerAccessCode,
        DATABASE_URL: fakeSecrets.privateEnv,
      } as any);

      const response = await authed(app, AppRole.ADMIN)
        .get(`/admin/support/payments/${PAYMENT_ID}`)
        .expect(200);

      assertJsonDoesNotContainSecrets(response.body);
      expect(JSON.stringify(response.body)).not.toContain('providerRawResponse');
      expect(JSON.stringify(response.body)).not.toContain('providerVerificationRaw');
      expect(JSON.stringify(response.body)).not.toContain('providerCheckoutUrl');
      expect(JSON.stringify(response.body)).not.toContain('providerAccessCode');
    });

    it('does not expose ticket or admission token fields in ticket and admission support responses', async () => {
      repository.getTicketById.mockResolvedValueOnce({
        ...buildTicketRecord(),
        admissionTokenHash: fakeSecrets.admissionTokenHash,
      } as any);
      repository.getAdmissionScanById.mockResolvedValueOnce({
        ...buildAdmissionScanRecord(),
        tokenHash: fakeSecrets.tokenHash,
        scanNonceHash: fakeSecrets.scanNonceHash,
      } as any);

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
    });

    it('redacts sensitive values from audit-log responses and does not expose raw webhook payload fields', async () => {
      repository.listAuditLogs.mockResolvedValueOnce(
        createListResult([
          {
            ...buildAuditLogRecord(),
            reasonNote: `contained ${fakeSecrets.providerAccessCode}`,
            metadata: {
              rawPayload: fakeSecrets.rawPayload,
              rawHeaders: {
                authorization: fakeSecrets.rawHeaders,
              },
              verifiedPayload: {
                cookie: fakeSecrets.cookie,
              },
              DATABASE_URL: fakeSecrets.privateEnv,
              safe: 'visible',
            },
          } as any,
        ]),
      );

      const response = await authed(app, AppRole.ADMIN)
        .get('/admin/support/audit-logs')
        .expect(200);
      const json = JSON.stringify(response.body);

      expect(json).toContain('[REDACTED]');
      expect(json).toContain('visible');
      expect(json).not.toContain(fakeSecrets.rawPayload);
      expect(json).not.toContain(fakeSecrets.rawHeaders);
      expect(json).not.toContain(fakeSecrets.privateEnv);
      expect(json).not.toContain(fakeSecrets.providerAccessCode);
      expect(json).not.toContain('rawPayload');
      expect(json).not.toContain('rawHeaders');
      expect(json).not.toContain('verifiedPayload');
    });

    it('fails closed on normal support reads when audit persistence fails', async () => {
      auditService.recordRead.mockRejectedValueOnce(
        new InternalServerErrorException('Internal server error'),
      );

      const response = await authed(app, AppRole.ADMIN)
        .get('/admin/support/users')
        .expect(500);

      expect(JSON.stringify(response.body)).not.toContain('customer@govibe.test');
    });

    it('does not register mutation routes and does not touch mutation-like collaborators', async () => {
      const routes = [
        `/admin/support/organizers/${ORGANIZER_ID}/status`,
        `/admin/support/payments/${PAYMENT_ID}/state`,
        `/admin/support/tickets/${TICKET_ID}/issue`,
        `/admin/support/admission-scans/${ADMISSION_SCAN_ID}/grant`,
        '/admin/support/payouts',
        '/admin/support/refunds',
      ];

      for (const route of routes) {
        await authed(app, AppRole.ADMIN).post(route).expect(404);
      }

      await authed(app, AppRole.ADMIN)
        .get('/admin/support/users')
        .expect(200);

      expect(providerBoundarySpies.initiatePayment).not.toHaveBeenCalled();
      expect(providerBoundarySpies.verifyPayment).not.toHaveBeenCalled();
      expect(repository.updatePaymentState).not.toHaveBeenCalled();
      expect(repository.issueTickets).not.toHaveBeenCalled();
      expect(repository.grantAdmissions).not.toHaveBeenCalled();
      expect(repository.mutateAdmissionState).not.toHaveBeenCalled();
    });
  });
});

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
    post(path: string) {
      return applyAuth(http.post(path));
    },
  };
}

function createListResult<T>(items: T[]) {
  return {
    items,
    limit: 25,
    offset: 0,
    resultCount: items.length,
  };
}

function buildUserRecord() {
  return {
    id: USER_ID,
    email: 'customer@govibe.test',
    role: UserRole.CUSTOMER,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}

function buildOrganizerRecord() {
  return {
    id: ORGANIZER_ID,
    ownerUserId: USER_ID,
    displayName: 'GoVibe Live',
    slug: 'govibe-live',
    status: OrganizerStatus.APPROVED,
    contactEmail: null,
    contactPhone: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}

function buildEventRecord() {
  return {
    id: EVENT_ID,
    organizerId: ORGANIZER_ID,
    title: 'GoVibe Festival',
    slug: 'govibe-festival',
    status: EventStatus.PUBLISHED,
    visibility: EventVisibility.PUBLIC,
    category: EventCategory.FESTIVAL,
    startsAt: new Date('2026-03-01T12:00:00.000Z'),
    endsAt: new Date('2026-03-01T18:00:00.000Z'),
    venueName: 'Accra Arena',
    city: 'Accra',
    country: 'Ghana',
    paymentEnabled: true,
    priceMinor: 15000,
    priceCurrency: 'GHS',
    publishedAt: new Date('2026-02-20T10:00:00.000Z'),
    cancelledAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };
}

function buildPaymentRecord() {
  return {
    id: PAYMENT_ID,
    buyerUserId: USER_ID,
    organizerId: ORGANIZER_ID,
    eventId: EVENT_ID,
    provider: PaymentProvider.PAYSTACK,
    status: PaymentIntentStatus.VERIFIED,
    amountMinor: 15000,
    currency: 'GHS',
    providerReference: 'pay_ref_123',
    providerVerifiedStatus: 'success',
    providerVerifiedAmount: 15000,
    providerVerifiedCurrency: 'GHS',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    verifiedAt: new Date('2026-01-02T00:00:00.000Z'),
    failedAt: null,
  };
}

function buildTicketRecord() {
  return {
    id: TICKET_ID,
    ticketNumber: 'GV-001',
    ownerUserId: USER_ID,
    eventId: EVENT_ID,
    organizerId: ORGANIZER_ID,
    paymentIntentId: PAYMENT_ID,
    status: TicketStatus.ISSUED,
    issuedAt: new Date('2026-01-01T00:00:00.000Z'),
    usedAt: null,
    voidedAt: null,
    expiresAt: null,
  };
}

function buildAdmissionScanRecord() {
  return {
    id: ADMISSION_SCAN_ID,
    ticketId: TICKET_ID,
    eventId: EVENT_ID,
    organizerId: ORGANIZER_ID,
    scannedByUserId: ADMIN_USER_ID,
    status: 'ACCEPTED',
    rejectionReason: null,
    deviceId: 'device-1',
    gateLabel: 'north-gate',
    scannedAt: new Date('2026-01-03T00:00:00.000Z'),
  };
}

function buildAuditLogRecord() {
  return {
    id: AUDIT_LOG_ID,
    actorUserId: ADMIN_USER_ID,
    action: 'admin_support_read_user',
    status: AdminActionStatus.SUCCEEDED,
    targetType: 'user',
    targetId: USER_ID,
    reasonCode: 'SUPPORT_READ',
    reasonNote: null,
    metadata: {
      route: 'GET /admin/support/users/:userId',
      resultCount: 1,
    },
    createdAt: new Date('2026-01-04T00:00:00.000Z'),
  };
}

function assertJsonDoesNotContainSecrets(value: unknown): void {
  const json = JSON.stringify(value);

  for (const secret of Object.values(fakeSecrets)) {
    expect(json).not.toContain(secret);
  }
}
