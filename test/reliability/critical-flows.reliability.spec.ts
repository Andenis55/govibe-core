/*
This is a Workstream 8 reliability validation suite.
It must not add product behavior.
It must not change business logic.
It validates approved Workstreams 1-7 behavior only.
*/

import { UserRole } from '@prisma/client';
import { AdminSupportAuditService } from '../../src/modules/admin-support/admin-support-audit.service';
import { AdminSupportRedactionService } from '../../src/modules/admin-support/admin-support-redaction.service';
import { AdminSupportRepository } from '../../src/modules/admin-support/admin-support.repository';
import { AdminSupportService } from '../../src/modules/admin-support/admin-support.service';
import {
  ContainerRuntimeUnavailableError,
  createWs8TicketsAdmissionsRuntime,
  Ws8TicketsAdmissionsRuntime,
} from '../support/ws8-tickets-admissions-runtime';
import { seedPaymentIntentGraph } from '../support/ws8-reliability-fixtures';

const ADMIN_USER_ID = '81000000-0000-4000-8000-000000000099';

describe('Workstream 8 critical flow reliability', () => {
  let runtime: Ws8TicketsAdmissionsRuntime | null = null;

  beforeAll(async () => {
    try {
      runtime = await createWs8TicketsAdmissionsRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }
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

  it('issues a ticket, accepts an admission scan, and returns redacted support reads without touching providers', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedPaymentIntentGraph(runtime.prisma);

    await runtime.prisma.user.create({
      data: {
        id: ADMIN_USER_ID,
        email: 'admin-support@govibe.test',
        passwordHash:
          '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        role: UserRole.ADMIN,
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    const issued = await runtime.ticketIssuanceService.issueTicketFromVerifiedPayment(
      seeded.paymentIntentId,
    );
    const scan = await runtime.admissionsService.scanTicket({
      ticketId: issued.ticket.id,
      token: issued.qrPayload!.token,
      scannedByUserId: seeded.organizerOwnerUserId,
      eventId: seeded.eventId,
    });
    const scanAudit = await runtime.prisma.admissionScanAudit.findFirstOrThrow({
      where: { ticketId: issued.ticket.id },
      orderBy: { scannedAt: 'desc' },
    });

    const redaction = new AdminSupportRedactionService();
    const repository = new AdminSupportRepository(runtime.prisma);
    const audit = new AdminSupportAuditService(repository, redaction);
    const support = new AdminSupportService(repository, audit, redaction);

    const ticketResponse = await support.getTicket(ADMIN_USER_ID, issued.ticket.id);
    const admissionResponse = await support.getAdmissionScan(
      ADMIN_USER_ID,
      scanAudit.id,
    );

    expect(issued.ticket.ownerUserId).toBe(seeded.buyerUserId);
    expect(issued.qrPayload?.ticketId).toBe(issued.ticket.id);
    expect(scan).toEqual(
      expect.objectContaining({
        accepted: true,
        ticketId: issued.ticket.id,
      }),
    );
    expect(ticketResponse.id).toBe(issued.ticket.id);
    expect(admissionResponse.id).toBe(scanAudit.id);
    expect(JSON.stringify(ticketResponse)).not.toContain('admissionTokenHash');
    expect(JSON.stringify(admissionResponse)).not.toContain('tokenHash');
    expect(JSON.stringify(admissionResponse)).not.toContain('scanNonceHash');
    expect(await runtime.prisma.adminSupportAuditLog.count()).toBe(2);
    expect(runtime.paystackVerificationAdapter.verifyByReference).not.toHaveBeenCalled();
    expect(runtime.momoVerificationAdapter.verifyByReference).not.toHaveBeenCalled();
  });
});