/*
This is a Workstream 8 reliability validation suite.
It must not add product behavior.
It must not change business logic.
It validates approved Workstreams 1-7 behavior only.
*/

import {
  AdmissionRejectionReason,
  AdmissionScanStatus,
  TicketStatus,
} from '@prisma/client';
import { AdmissionAuditService } from '../../src/modules/admissions/application/admission-audit.service';
import { AdmissionsService } from '../../src/modules/admissions/application/admissions.service';
import { PrismaAdmissionRepository } from '../../src/modules/admissions/infrastructure/repositories/prisma-admission.repository';
import { TicketTokenService } from '../../src/modules/tickets/application/ticket-token.service';
import { PrismaTicketRepository } from '../../src/modules/tickets/infrastructure/repositories/prisma-ticket.repository';
import { TransactionRunnerService } from '../../src/shared/prisma/transaction-runner.service';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from '../setup/integration-runtime';
import { seedEventInventory } from '../setup/seed-data';
import { seedIssuedTicket } from '../support/ws8-reliability-fixtures';

describe('Workstream 8 admission replay reliability', () => {
  let runtime: IntegrationRuntime | null = null;
  let admissionsService: AdmissionsService;
  let ticketTokenService: TicketTokenService;

  beforeAll(async () => {
    try {
      runtime = await createIntegrationRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }

    ticketTokenService = new TicketTokenService();
    const admissionRepository = new PrismaAdmissionRepository(runtime.prisma);
    admissionsService = new AdmissionsService(
      new TransactionRunnerService(runtime.prisma),
      new AdmissionAuditService(admissionRepository),
      ticketTokenService,
      new PrismaTicketRepository(runtime.prisma),
    );
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  beforeEach(async () => {
    if (runtime) {
      await runtime.reset();
    }
  });

  it('accepts the first scan, rejects the replay, and records ordered audit outcomes', async () => {
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

    const accepted = await admissionsService.scanTicket({
      ticketId: issued.ticketId,
      token: issued.token,
      scannedByUserId: seeded.userId,
      eventId: seeded.eventId,
    });
    const replay = await admissionsService.scanTicket({
      ticketId: issued.ticketId,
      token: issued.token,
      scannedByUserId: seeded.userId,
      eventId: seeded.eventId,
    });

    const ticket = await runtime.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    const audits = await runtime.prisma.admissionScanAudit.findMany({
      where: { ticketId: issued.ticketId },
      orderBy: { scannedAt: 'asc' },
    });

    expect(accepted).toEqual(
      expect.objectContaining({
        accepted: true,
        status: AdmissionScanStatus.ACCEPTED,
        rejectionReason: null,
        ticketId: issued.ticketId,
      }),
    );
    expect(replay).toEqual(
      expect.objectContaining({
        accepted: false,
        status: AdmissionScanStatus.REJECTED,
        rejectionReason: AdmissionRejectionReason.TICKET_ALREADY_USED,
        ticketId: null,
      }),
    );
    expect(ticket.status).toBe(TicketStatus.USED);
    expect(ticket.usedAt).not.toBeNull();
    expect(audits).toHaveLength(2);
    expect(audits.map((audit) => audit.status)).toEqual([
      AdmissionScanStatus.ACCEPTED,
      AdmissionScanStatus.REJECTED,
    ]);
    expect(audits[1]?.rejectionReason).toBe(
      AdmissionRejectionReason.TICKET_ALREADY_USED,
    );
  });

  it('rejects a wrong token without leaking ticket state and without mutating the ticket', async () => {
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
    const wrongToken = ticketTokenService.generateAdmissionToken().token;

    const rejected = await admissionsService.scanTicket({
      ticketId: issued.ticketId,
      token: wrongToken,
      scannedByUserId: seeded.userId,
      eventId: seeded.eventId,
    });

    const ticket = await runtime.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    const responseJson = JSON.stringify(rejected);

    expect(rejected).toEqual(
      expect.objectContaining({
        accepted: false,
        status: AdmissionScanStatus.REJECTED,
        rejectionReason: AdmissionRejectionReason.INVALID_TOKEN,
        ticketId: null,
      }),
    );
    expect(ticket.status).toBe(TicketStatus.ISSUED);
    expect(ticket.usedAt).toBeNull();
    expect(responseJson).not.toContain(issued.ticketId);
    expect(responseJson).not.toContain('admissionTokenHash');
    expect(responseJson).not.toContain('USED');
  });

  it('accepts exactly one of two concurrent duplicate scans and leaves a deterministic final state', async () => {
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

    const [left, right] = await Promise.all([
      admissionsService.scanTicket({
        ticketId: issued.ticketId,
        token: issued.token,
        scannedByUserId: seeded.userId,
        eventId: seeded.eventId,
      }),
      admissionsService.scanTicket({
        ticketId: issued.ticketId,
        token: issued.token,
        scannedByUserId: seeded.userId,
        eventId: seeded.eventId,
      }),
    ]);

    const accepted = [left, right].filter((result) => result.accepted);
    const rejected = [left, right].filter((result) => !result.accepted);
    const ticket = await runtime.prisma.ticket.findUniqueOrThrow({
      where: { id: issued.ticketId },
    });
    const audits = await runtime.prisma.admissionScanAudit.findMany({
      where: { ticketId: issued.ticketId },
      orderBy: { scannedAt: 'asc' },
    });

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(ticket.status).toBe(TicketStatus.USED);
    expect(ticket.usedAt).not.toBeNull();
    expect(audits).toHaveLength(2);
    expect(audits.filter((audit) => audit.status === AdmissionScanStatus.ACCEPTED)).toHaveLength(1);
    expect(audits.filter((audit) => audit.status === AdmissionScanStatus.REJECTED)).toHaveLength(1);
    expect([
      AdmissionRejectionReason.TICKET_ALREADY_USED,
      AdmissionRejectionReason.TOKEN_REPLAY_DETECTED,
    ]).toContain(rejected[0]?.rejectionReason ?? null);
  });
});