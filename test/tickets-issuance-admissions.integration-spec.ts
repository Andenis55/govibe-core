import { randomUUID } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  AdmissionRejectionReason,
  AdmissionScanStatus,
  EventStatus,
  OrganizerStatus,
  PaymentIntentStatus,
  PaymentProvider,
  Prisma,
  TicketStatus,
  UserRole,
} from '@prisma/client';
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';
import { AppRole } from '../src/common/constants/roles';
import { AppPermission } from '../src/common/constants/permissions';
import { AuthUser } from '../src/common/types/auth-user.type';
import { AdmissionsService } from '../src/modules/admissions/application/admissions.service';
import { AdmissionAuditService } from '../src/modules/admissions/application/admission-audit.service';
import { QR_TOKEN_VERIFIER } from '../src/modules/admissions/admissions.tokens';
import { PaymentIntentRepository } from '../src/modules/payments/domain/repositories/payment-intent.repository.interface';
import { PaystackVerificationAdapter } from '../src/modules/payments/verification/paystack-verification.adapter';
import { MtnMomoVerificationAdapter } from '../src/modules/payments/verification/mtn-momo-verification.adapter';
import { PAYMENT_INTENT_REPOSITORY } from '../src/modules/payments/payments.tokens';
import { TicketIssuanceService } from '../src/modules/tickets/application/ticket-issuance.service';
import {
  TicketRepository,
  TicketViewRecord,
} from '../src/modules/tickets/domain/repositories/ticket.repository.interface';
import { TICKET_REPOSITORY } from '../src/modules/tickets/tickets.tokens';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { RedisService } from '../src/shared/redis/redis.service';
import { OUTBOX_DISPATCHER } from '../src/shared/outbox/outbox.tokens';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from './setup/integration-runtime';
import { createTestApp } from './setup/test-app.factory';
import { InvalidStateTransitionError } from '../src/shared/errors/domain-errors';

type TicketsAdmissionsRuntime = IntegrationRuntime & {
  app: INestApplication;
  ticketIssuanceService: TicketIssuanceService;
  admissionsService: AdmissionsService;
  admissionAuditService: AdmissionAuditService;
  paymentIntentRepository: PaymentIntentRepository;
  ticketRepository: TicketRepository;
  paystackVerificationAdapter: PaystackVerificationAdapter;
  momoVerificationAdapter: MtnMomoVerificationAdapter;
  dispose: () => Promise<void>;
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

    const userId = request.headers['x-test-user-id'] ?? randomUUID();
    const roleHeader = request.headers['x-test-role'] ?? AppRole.CUSTOMER;
    const role =
      roleHeader === AppRole.ORGANIZER ||
      roleHeader === AppRole.GATE_STAFF ||
      roleHeader === AppRole.ADMIN
        ? roleHeader
        : AppRole.CUSTOMER;

    request.user = {
      id: userId,
      email: `${userId}@example.com`,
      role,
      sessionId: `session-${userId}`,
      permissions: [] as AppPermission[],
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    return true;
  }
}

type SeededGraph = {
  buyerUserId: string;
  organizerOwnerUserId: string;
  organizerId: string;
  venueId: string;
  eventId: string;
  paymentIntentId: string;
  providerReference: string;
  amountMinor: number;
  currency: string;
};

describe('Tickets issuance and admissions', () => {
  let runtime: TicketsAdmissionsRuntime | null = null;

  beforeAll(async () => {
    let integration: IntegrationRuntime;

    try {
      integration = await createIntegrationRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }

    const builder = Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(integration.prisma)
      .overrideProvider('REDIS_CLIENT')
      .useValue(integration.redisClient)
      .overrideProvider(RedisService)
      .useValue(integration.redisService)
      .overrideProvider(QR_TOKEN_VERIFIER)
      .useValue({ verify: jest.fn() })
      .overrideProvider(OUTBOX_DISPATCHER)
      .useValue({ dispatch: jest.fn() })
      .overrideGuard(JwtAuthGuard)
      .useValue(new TestJwtAuthGuard());

    const app = await createTestApp(builder);

    runtime = {
      ...integration,
      app,
      ticketIssuanceService: app.get(TicketIssuanceService),
      admissionsService: app.get(AdmissionsService),
      admissionAuditService: app.get(AdmissionAuditService),
      paymentIntentRepository: app.get(PAYMENT_INTENT_REPOSITORY),
      ticketRepository: app.get(TICKET_REPOSITORY),
      paystackVerificationAdapter: app.get(PaystackVerificationAdapter),
      momoVerificationAdapter: app.get(MtnMomoVerificationAdapter),
      dispose: async () => {
        await Promise.allSettled([app.close(), integration.dispose()]);
      },
    };
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  beforeEach(async () => {
    if (!runtime) {
      return;
    }

    jest.restoreAllMocks();
    await runtime.reset();
  });

  describe('ticket issuance', () => {
    it('cannot issue ticket from INITIATED PaymentIntent', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime, {
        paymentIntentStatus: PaymentIntentStatus.INITIATED,
      });

      await expect(
        runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
          seeded.paymentIntentId,
        ),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    it('cannot issue ticket from INITIATION_PENDING PaymentIntent', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime, {
        paymentIntentStatus: PaymentIntentStatus.INITIATION_PENDING,
      });

      await expect(
        runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
          seeded.paymentIntentId,
        ),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    it('cannot issue ticket from FAILED PaymentIntent', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime, {
        paymentIntentStatus: PaymentIntentStatus.FAILED,
      });

      await expect(
        runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
          seeded.paymentIntentId,
        ),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    it('cannot issue ticket from INITIATION_FAILED PaymentIntent', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime, {
        paymentIntentStatus: PaymentIntentStatus.INITIATION_FAILED,
      });

      await expect(
        runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
          seeded.paymentIntentId,
        ),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);
    });

    it('can issue ticket from VERIFIED PaymentIntent', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);

      const result = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      expect(result.ticket.ownerUserId).toBe(seeded.buyerUserId);
      expect(result.qrPayload?.ticketId).toBe(result.ticket.id);
      expect(result.qrPayload?.token).toHaveLength(43);
    });

    it('verified payment intent with missing relation snapshot cannot produce ticket', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      jest
        .spyOn(runtime.paymentIntentRepository, 'findByIdForTicketIssuance')
        .mockResolvedValueOnce({
          ...(await runtime.paymentIntentRepository.findByIdForTicketIssuance(
            seeded.paymentIntentId,
          ))!,
          buyer: null,
          organizer: null,
          event: null,
        } as never);

      await expect(
        runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
          seeded.paymentIntentId,
        ),
      ).rejects.toBeInstanceOf(InvalidStateTransitionError);

      expect(await runtime.prisma.ticket.count()).toBe(0);
    });

    it('issued ticket ownerUserId equals PaymentIntent.buyerUserId', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const result = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      expect(result.ticket.ownerUserId).toBe(seeded.buyerUserId);
    });

    it('issued ticket eventId equals PaymentIntent.eventId', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const result = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      expect(result.ticket.eventId).toBe(seeded.eventId);
    });

    it('issued ticket organizerId equals PaymentIntent.organizerId', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const result = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      expect(result.ticket.organizerId).toBe(seeded.organizerId);
    });

    it('ticket expiresAt defaults to event.endsAt', async () => {
      if (!runtime) return;

      const endsAt = new Date('2026-07-01T23:30:00.000Z');
      const seeded = await seedPaymentIntent(runtime, {
        eventEndsAt: endsAt,
      });
      const result = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      expect(result.ticket.expiresAt?.toISOString()).toBe(endsAt.toISOString());
    });

    it('issued ticket stores admissionTokenHash, not raw token', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const result = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const stored = await runtime.prisma.ticket.findUniqueOrThrow({
        where: { id: result.ticket.id },
      });

      expect(stored.admissionTokenHash).toBeTruthy();
      expect(stored.admissionTokenHash).not.toBe(result.qrPayload?.token);
    });

    it('issue response returns raw token only once', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const first = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      const second = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      expect(first.qrPayload?.token).toBeTruthy();
      expect(second.qrPayload).toBeNull();
    });

    it('duplicate issuance for same verified PaymentIntent returns existing ticket', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const first = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      const replay = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      expect(replay.ticket.id).toBe(first.ticket.id);
      expect(replay.qrPayload).toBeNull();
      expect(await runtime.prisma.ticket.count()).toBe(1);
    });

    it('concurrent duplicate issuance creates only one ticket', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);

      const [left, right] = await Promise.all([
        runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
          seeded.paymentIntentId,
        ),
        runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
          seeded.paymentIntentId,
        ),
      ]);

      expect(await runtime.prisma.ticket.count()).toBe(1);
      expect(left.ticket.id).toBe(right.ticket.id);
      expect([left.qrPayload, right.qrPayload].filter(Boolean)).toHaveLength(1);
    });

    it('P2002 during issuance reloads existing ticket', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const first = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      const findSpy = jest
        .spyOn(runtime.ticketRepository, 'findByPaymentIntentOwnerAndEvent')
        .mockImplementationOnce(async () => null)
        .mockImplementation(runtime.ticketRepository.findByPaymentIntentOwnerAndEvent.bind(runtime.ticketRepository));
      jest
        .spyOn(runtime.ticketRepository, 'createIssuedTicket')
        .mockRejectedValueOnce({ code: 'P2002' });

      const replay = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      expect(findSpy).toHaveBeenCalled();
      expect(replay.ticket.id).toBe(first.ticket.id);
      expect(replay.qrPayload).toBeNull();
    });

    it('ticket issuance audit and ticket creation are atomic', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
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

    it('ticket issuance writes durable audit log', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const result = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const audits = await runtime.prisma.ticketIssuanceAuditLog.findMany({
        where: { paymentIntentId: seeded.paymentIntentId },
        orderBy: { createdAt: 'asc' },
      });

      expect(audits.map((audit) => audit.auditEvent)).toEqual([
        'ticket_issuance_requested',
        'ticket_issued',
      ]);
      expect(audits[1]?.ticketId).toBe(result.ticket.id);
    });

    it('no public or customer POST /tickets/issue-from-payment route exists', async () => {
      if (!runtime) return;

      await request(runtime.app.getHttpServer())
        .post('/tickets/issue-from-payment')
        .expect(404);
    });
  });

  describe('ticket reads', () => {
    it('GET /tickets/mine requires authentication', async () => {
      if (!runtime) return;

      await request(runtime.app.getHttpServer()).get('/tickets/mine').expect(401);
    });

    it('GET /tickets/mine requires TICKET_READ_OWN', async () => {
      if (!runtime) return;

      await request(runtime.app.getHttpServer())
        .get('/tickets/mine')
        .set(authHeaders({ userId: randomUUID(), role: AppRole.GATE_STAFF }))
        .expect(403);
    });

    it('GET /tickets/mine returns only current user tickets', async () => {
      if (!runtime) return;

      const left = await seedPaymentIntent(runtime, {});
      const right = await seedPaymentIntent(runtime, {});
      const leftTicket = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        left.paymentIntentId,
      );
      await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        right.paymentIntentId,
      );

      const response = await request(runtime.app.getHttpServer())
        .get('/tickets/mine')
        .set(authHeaders({ userId: left.buyerUserId, role: AppRole.CUSTOMER }))
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0]?.id).toBe(leftTicket.ticket.id);
    });

    it('GET /tickets/mine does not expose raw token', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const response = await request(runtime.app.getHttpServer())
        .get('/tickets/mine')
        .set(authHeaders({ userId: seeded.buyerUserId, role: AppRole.CUSTOMER }))
        .expect(200);

      expect(response.body[0]).not.toHaveProperty('token');
      expect(response.body[0]).not.toHaveProperty('qrPayload');
    });

    it('GET /tickets/mine does not expose admissionTokenHash', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const response = await request(runtime.app.getHttpServer())
        .get('/tickets/mine')
        .set(authHeaders({ userId: seeded.buyerUserId, role: AppRole.CUSTOMER }))
        .expect(200);

      expect(response.body[0]).not.toHaveProperty('admissionTokenHash');
    });

    it('GET /tickets/:ticketId requires authentication', async () => {
      if (!runtime) return;

      await request(runtime.app.getHttpServer())
        .get(`/tickets/${randomUUID()}`)
        .expect(401);
    });

    it('GET /tickets/:ticketId requires TICKET_READ_OWN', async () => {
      if (!runtime) return;

      await request(runtime.app.getHttpServer())
        .get(`/tickets/${randomUUID()}`)
        .set(authHeaders({ userId: randomUUID(), role: AppRole.GATE_STAFF }))
        .expect(403);
    });

    it('GET /tickets/:ticketId returns 404 for non-owner', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      await request(runtime.app.getHttpServer())
        .get(`/tickets/${issued.ticket.id}`)
        .set(authHeaders({ userId: randomUUID(), role: AppRole.CUSTOMER }))
        .expect(404);
    });

    it('GET /tickets/:ticketId does not expose raw token', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const response = await request(runtime.app.getHttpServer())
        .get(`/tickets/${issued.ticket.id}`)
        .set(authHeaders({ userId: seeded.buyerUserId, role: AppRole.CUSTOMER }))
        .expect(200);

      expect(response.body).not.toHaveProperty('token');
      expect(response.body).not.toHaveProperty('qrPayload');
    });

    it('GET /tickets/:ticketId does not expose admissionTokenHash', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const response = await request(runtime.app.getHttpServer())
        .get(`/tickets/${issued.ticket.id}`)
        .set(authHeaders({ userId: seeded.buyerUserId, role: AppRole.CUSTOMER }))
        .expect(200);

      expect(response.body).not.toHaveProperty('admissionTokenHash');
    });

    it('ticket response does not expose payment provider reference', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const response = await request(runtime.app.getHttpServer())
        .get(`/tickets/${issued.ticket.id}`)
        .set(authHeaders({ userId: seeded.buyerUserId, role: AppRole.CUSTOMER }))
        .expect(200);

      expect(response.body).not.toHaveProperty('providerReference');
    });

    it('ticket response does not expose sensitive payment fields', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const response = await request(runtime.app.getHttpServer())
        .get(`/tickets/${issued.ticket.id}`)
        .set(authHeaders({ userId: seeded.buyerUserId, role: AppRole.CUSTOMER }))
        .expect(200);

      expect(response.body).not.toHaveProperty('paymentIntentId');
      expect(response.body).not.toHaveProperty('providerVerificationRaw');
      expect(response.body).not.toHaveProperty('providerRawResponse');
    });
  });

  describe('admission scan', () => {
    it('unauthenticated admission scan is rejected', async () => {
      if (!runtime) return;

      await request(runtime.app.getHttpServer())
        .post('/admissions/scan')
        .send({ ticketId: randomUUID(), token: 'x'.repeat(32) })
        .expect(401);
    });

    it('authenticated user without ADMISSION_SCAN_EVENT is rejected', async () => {
      if (!runtime) return;

      await request(runtime.app.getHttpServer())
        .post('/admissions/scan')
        .set(authHeaders({ userId: randomUUID(), role: AppRole.CUSTOMER }))
        .send({ ticketId: randomUUID(), token: 'x'.repeat(32) })
        .expect(403);
    });

    it('organizer owner can scan own event ticket', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const response = await request(runtime.app.getHttpServer())
        .post('/admissions/scan')
        .set(
          authHeaders({
            userId: seeded.organizerOwnerUserId,
            role: AppRole.ORGANIZER,
          }),
        )
        .send({
          ticketId: issued.ticket.id,
          token: issued.qrPayload?.token,
          eventId: seeded.eventId,
        })
        .expect(200);

      expect(response.body.accepted).toBe(true);
      expect(response.body.status).toBe(AdmissionScanStatus.ACCEPTED);
    });

    it('organizer owner cannot scan another organizer event ticket', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const response = await request(runtime.app.getHttpServer())
        .post('/admissions/scan')
        .set(
          authHeaders({
            userId: randomUUID(),
            role: AppRole.ORGANIZER,
          }),
        )
        .send({
          ticketId: issued.ticket.id,
          token: issued.qrPayload?.token,
          eventId: seeded.eventId,
        })
        .expect(200);

      expect(response.body.accepted).toBe(false);
      expect(response.body.rejectionReason).toBe(
        AdmissionRejectionReason.STAFF_NOT_AUTHORIZED,
      );
      expect(response.body.ticketId).toBeNull();
    });

    it('unauthorized organizer scan writes STAFF_NOT_AUTHORIZED audit', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      await request(runtime.app.getHttpServer())
        .post('/admissions/scan')
        .set(
          authHeaders({
            userId: randomUUID(),
            role: AppRole.ORGANIZER,
          }),
        )
        .send({ ticketId: issued.ticket.id, token: issued.qrPayload?.token })
        .expect(200);

      const audit = await runtime.prisma.admissionScanAudit.findFirstOrThrow({
        orderBy: { scannedAt: 'desc' },
      });
      expect(audit.rejectionReason).toBe(
        AdmissionRejectionReason.STAFF_NOT_AUTHORIZED,
      );
    });

    it('valid ticket scan is accepted', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const result = await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
        eventId: seeded.eventId,
      });

      expect(result.accepted).toBe(true);
      expect(result.status).toBe(AdmissionScanStatus.ACCEPTED);
    });

    it('accepted scan marks ticket USED', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      const ticket = await runtime.prisma.ticket.findUniqueOrThrow({
        where: { id: issued.ticket.id },
      });
      expect(ticket.status).toBe(TicketStatus.USED);
      expect(ticket.usedAt).not.toBeNull();
    });

    it('accepted scan writes AdmissionScanAudit ACCEPTED', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      const audit = await runtime.prisma.admissionScanAudit.findFirstOrThrow();
      expect(audit.status).toBe(AdmissionScanStatus.ACCEPTED);
    });

    it('accepted admission scan and USED status update are atomic', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      const original = runtime.admissionAuditService.record.bind(
        runtime.admissionAuditService,
      );

      jest
        .spyOn(runtime.admissionAuditService, 'record')
        .mockImplementation(async (input, options) => {
          if (input.status === AdmissionScanStatus.ACCEPTED) {
            throw new Error('admission audit failure');
          }

          await original(input, options);
        });

      await expect(
        runtime.admissionsService.scanTicket({
          ticketId: issued.ticket.id,
          token: issued.qrPayload!.token,
          scannedByUserId: seeded.organizerOwnerUserId,
        }),
      ).rejects.toThrow('admission audit failure');

      const ticket = await runtime.prisma.ticket.findUniqueOrThrow({
        where: { id: issued.ticket.id },
      });
      expect(ticket.status).toBe(TicketStatus.ISSUED);
      expect(await runtime.prisma.admissionScanAudit.count()).toBe(0);
    });

    it('same ticket scanned again is rejected as TICKET_ALREADY_USED', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });
      const replay = await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(replay.accepted).toBe(false);
      expect(replay.rejectionReason).toBe(
        AdmissionRejectionReason.TICKET_ALREADY_USED,
      );
    });

    it('replay scan writes AdmissionScanAudit REJECTED', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });
      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      const rejected = await runtime.prisma.admissionScanAudit.findFirstOrThrow({
        where: { status: AdmissionScanStatus.REJECTED },
      });
      expect(rejected.rejectionReason).toBe(
        AdmissionRejectionReason.TICKET_ALREADY_USED,
      );
    });

    it('admission scan with correct ticketId but wrong token returns INVALID_TOKEN', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const result = await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: 'y'.repeat(64),
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(result.accepted).toBe(false);
      expect(result.rejectionReason).toBe(
        AdmissionRejectionReason.INVALID_TOKEN,
      );
    });

    it('wrong-token scan does not reveal USED or VOIDED state', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      await runtime.prisma.ticket.update({
        where: { id: issued.ticket.id },
        data: {
          status: TicketStatus.USED,
          usedAt: new Date(),
        },
      });

      const result = await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: 'z'.repeat(64),
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(result.rejectionReason).toBe(
        AdmissionRejectionReason.INVALID_TOKEN,
      );
      expect(result.ticketId).toBeNull();
    });

    it('invalid token does not mark ticket USED', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: 'x'.repeat(64),
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      const ticket = await runtime.prisma.ticket.findUniqueOrThrow({
        where: { id: issued.ticket.id },
      });
      expect(ticket.status).toBe(TicketStatus.ISSUED);
    });

    it('wrong event scan is rejected as EVENT_MISMATCH', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const result = await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
        eventId: randomUUID(),
      });

      expect(result.rejectionReason).toBe(
        AdmissionRejectionReason.EVENT_MISMATCH,
      );
    });

    it('voided ticket scan is rejected', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      await runtime.prisma.ticket.update({
        where: { id: issued.ticket.id },
        data: {
          status: TicketStatus.VOIDED,
          voidedAt: new Date(),
        },
      });

      const result = await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(result.rejectionReason).toBe(
        AdmissionRejectionReason.TICKET_VOIDED,
      );
    });

    it('expired-by-expiresAt ticket is rejected at scan time', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      await runtime.prisma.ticket.update({
        where: { id: issued.ticket.id },
        data: { expiresAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      const result = await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(result.rejectionReason).toBe(
        AdmissionRejectionReason.TICKET_EXPIRED,
      );
    });

    it('expired-by-event.endsAt ticket is rejected at scan time', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime, {
        eventEndsAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const result = await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(result.rejectionReason).toBe(
        AdmissionRejectionReason.EVENT_NOT_ACTIVE,
      );
    });

    it('expired-by-expiresAt rejection writes AdmissionScanAudit REJECTED with TICKET_EXPIRED', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      await runtime.prisma.ticket.update({
        where: { id: issued.ticket.id },
        data: { expiresAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      const audit = await runtime.prisma.admissionScanAudit.findFirstOrThrow({
        where: { status: AdmissionScanStatus.REJECTED },
      });
      expect(audit.rejectionReason).toBe(
        AdmissionRejectionReason.TICKET_EXPIRED,
      );
    });

    it('ticket status remains ISSUED after time-based expiration rejection', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      await runtime.prisma.ticket.update({
        where: { id: issued.ticket.id },
        data: { expiresAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      const ticket = await runtime.prisma.ticket.findUniqueOrThrow({
        where: { id: issued.ticket.id },
      });
      expect(ticket.status).toBe(TicketStatus.ISSUED);
    });

    it('no background status mutation to EXPIRED occurs in Workstream 5', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      await runtime.prisma.ticket.update({
        where: { id: issued.ticket.id },
        data: { expiresAt: new Date('2026-01-01T00:00:00.000Z') },
      });

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(
        await runtime.prisma.ticket.count({ where: { status: TicketStatus.EXPIRED } }),
      ).toBe(0);
    });

    it('admission scan for non-published event is rejected', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime, {
        eventStatus: EventStatus.DRAFT,
      });
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      const result = await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(result.rejectionReason).toBe(
        AdmissionRejectionReason.EVENT_NOT_ACTIVE,
      );
    });

    it('rejected admission scan writes audit when ticket is missing', async () => {
      if (!runtime) return;

      const result = await runtime.admissionsService.scanTicket({
        ticketId: randomUUID(),
        token: 'x'.repeat(64),
        scannedByUserId: randomUUID(),
      });

      expect(result.rejectionReason).toBe(
        AdmissionRejectionReason.TICKET_NOT_FOUND,
      );
      expect(await runtime.prisma.admissionScanAudit.count()).toBe(1);
    });

    it('every admission decision is audited', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });
      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: 'invalid-invalid-invalid-invalid-invalid-invalid',
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(await runtime.prisma.admissionScanAudit.count()).toBe(2);
    });
  });

  describe('boundary checks', () => {
    it('ticket issuance does not initiate payment', async () => {
      if (!runtime) return;

      const before = await runtime.prisma.paymentIntent.count();
      const seeded = await seedPaymentIntent(runtime);
      await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      const after = await runtime.prisma.paymentIntent.count();

      expect(after).toBe(before + 1);
    });

    it('ticket issuance does not verify payment or call provider APIs', async () => {
      if (!runtime) return;

      const paystackSpy = jest.spyOn(
        runtime.paystackVerificationAdapter,
        'verifyByReference',
      );
      const momoSpy = jest.spyOn(
        runtime.momoVerificationAdapter,
        'verifyByReference',
      );
      const seeded = await seedPaymentIntent(runtime);

      await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      expect(paystackSpy).not.toHaveBeenCalled();
      expect(momoSpy).not.toHaveBeenCalled();
    });

    it('admission scan does not call provider APIs', async () => {
      if (!runtime) return;

      const paystackSpy = jest.spyOn(
        runtime.paystackVerificationAdapter,
        'verifyByReference',
      );
      const momoSpy = jest.spyOn(
        runtime.momoVerificationAdapter,
        'verifyByReference',
      );
      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(paystackSpy).not.toHaveBeenCalled();
      expect(momoSpy).not.toHaveBeenCalled();
    });

    it('admission scan does not trigger payment-side side effects', async () => {
      if (!runtime) return;

      const seeded = await seedPaymentIntent(runtime);
      const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
        seeded.paymentIntentId,
      );
      const beforePayments = await runtime.prisma.payment.count();
      const beforeWebhooks = await runtime.prisma.providerWebhookEvent.count();

      await runtime.admissionsService.scanTicket({
        ticketId: issued.ticket.id,
        token: issued.qrPayload!.token,
        scannedByUserId: seeded.organizerOwnerUserId,
      });

      expect(await runtime.prisma.payment.count()).toBe(beforePayments);
      expect(await runtime.prisma.providerWebhookEvent.count()).toBe(beforeWebhooks);
    });
  });
});

function authHeaders(input: {
  userId: string;
  role: AppRole;
}): Record<string, string> {
  return {
    Authorization: 'Bearer test-token',
    'x-test-user-id': input.userId,
    'x-test-role': input.role,
  };
}

async function seedPaymentIntent(
  runtime: TicketsAdmissionsRuntime,
  overrides?: Partial<{
    buyerUserId: string;
    organizerOwnerUserId: string;
    organizerId: string;
    venueId: string;
    eventId: string;
    paymentIntentId: string;
    paymentIntentStatus: PaymentIntentStatus;
    eventStatus: EventStatus;
    eventEndsAt: Date;
    amountMinor: number;
    currency: string;
  }>,
): Promise<SeededGraph> {
  const buyerUserId = overrides?.buyerUserId ?? randomUUID();
  const organizerOwnerUserId = overrides?.organizerOwnerUserId ?? randomUUID();
  const organizerId = overrides?.organizerId ?? randomUUID();
  const venueId = overrides?.venueId ?? randomUUID();
  const eventId = overrides?.eventId ?? randomUUID();
  const paymentIntentId = overrides?.paymentIntentId ?? randomUUID();
  const amountMinor = overrides?.amountMinor ?? 5000;
  const currency = overrides?.currency ?? 'GHS';
  const eventEndsAt =
    overrides?.eventEndsAt ?? new Date('2026-07-01T23:30:00.000Z');
  const eventStatus = overrides?.eventStatus ?? EventStatus.PUBLISHED;
  const paymentIntentStatus =
    overrides?.paymentIntentStatus ?? PaymentIntentStatus.VERIFIED;
  const providerReference = `pi-${paymentIntentId}`;

  await runtime.prisma.user.createMany({
    data: [
      {
        id: buyerUserId,
        email: `buyer-${buyerUserId}@example.com`,
        passwordHash:
          '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        role: UserRole.CUSTOMER,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: organizerOwnerUserId,
        email: `organizer-${organizerOwnerUserId}@example.com`,
        passwordHash:
          '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        role: UserRole.ORGANIZER,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
  });
  await runtime.prisma.organizer.create({
    data: {
      id: organizerId,
      ownerUserId: organizerOwnerUserId,
      displayName: 'Organizer Owner',
      slug: `organizer-${organizerId.slice(0, 8)}`,
      status: OrganizerStatus.APPROVED,
    },
  });
  await runtime.prisma.venue.create({
    data: {
      id: venueId,
    },
  });
  await runtime.prisma.event.create({
    data: {
      id: eventId,
      organizerId,
      venueId,
      title: 'WS5 Event',
      slug: `event-${eventId.slice(0, 8)}`,
      status: eventStatus,
      startsAt: new Date('2026-07-01T20:00:00.000Z'),
      endsAt: eventEndsAt,
      paymentEnabled: true,
      priceMinor: amountMinor,
      priceCurrency: currency,
      venueName: 'Accra Hall',
      city: 'Accra',
      country: 'Ghana',
      publishedAt:
        eventStatus === EventStatus.PUBLISHED
          ? new Date('2026-06-01T12:00:00.000Z')
          : null,
    },
  });
  await runtime.prisma.paymentIntent.create({
    data: {
      id: paymentIntentId,
      buyerUserId,
      organizerId,
      eventId,
      provider: PaymentProvider.PAYSTACK,
      status: paymentIntentStatus,
      amountMinor,
      currency,
      idempotencyUseCase: 'payments.initiate',
      idempotencyKeyHash: `key-${paymentIntentId}`,
      requestFingerprintHash: `fingerprint-${paymentIntentId}`,
      providerReference,
      verifiedAt:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED
          ? new Date('2026-06-01T12:30:00.000Z')
          : null,
      failedAt:
        paymentIntentStatus === PaymentIntentStatus.FAILED ||
        paymentIntentStatus === PaymentIntentStatus.INITIATION_FAILED
          ? new Date('2026-06-01T12:45:00.000Z')
          : null,
      providerVerifiedStatus:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED ? 'success' : null,
      providerVerifiedAmount:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED ? amountMinor : null,
      providerVerifiedCurrency:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED ? currency : null,
      providerVerificationRaw:
        paymentIntentStatus === PaymentIntentStatus.VERIFIED
          ? ({ status: 'success' } as Prisma.JsonObject)
          : Prisma.JsonNull,
    },
  });

  return {
    buyerUserId,
    organizerOwnerUserId,
    organizerId,
    venueId,
    eventId,
    paymentIntentId,
    providerReference,
    amountMinor,
    currency,
  };
}