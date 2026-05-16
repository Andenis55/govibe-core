import { randomUUID } from 'node:crypto';
import {
  AdmissionRejectionReason,
  AdmissionScanStatus,
  TicketStatus,
} from '@prisma/client';
import { AdmissionAuditService } from '../../../src/modules/admissions/application/admission-audit.service';
import { AdmissionsService } from '../../../src/modules/admissions/application/admissions.service';
import { PrismaAdmissionRepository } from '../../../src/modules/admissions/infrastructure/repositories/prisma-admission.repository';
import { TicketTokenService } from '../../../src/modules/tickets/application/ticket-token.service';
import { PrismaTicketRepository } from '../../../src/modules/tickets/infrastructure/repositories/prisma-ticket.repository';
import { TransactionRunnerService } from '../../../src/shared/prisma/transaction-runner.service';
import {
  ContainerRuntimeUnavailableError,
  createIntegrationRuntime,
  IntegrationRuntime,
} from '../../setup/integration-runtime';
import { seedEventInventory } from '../../setup/seed-data';

describe('admission lifecycle integration', () => {
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

  it('accepts the first scan, marks the ticket used, and rejects the replay with ordered audits', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedEventInventory(runtime.prisma);
    const issued = await seedIssuedTicket(runtime, ticketTokenService, {
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
    expect(audits[0]!.scannedAt.getTime()).toBeLessThanOrEqual(
      audits[1]!.scannedAt.getTime(),
    );
  });
});

async function seedIssuedTicket(
  runtime: IntegrationRuntime,
  ticketTokenService: TicketTokenService,
  input: {
    ownerUserId: string;
    organizerId: string;
    eventId: string;
    ticketTypeId: string;
    status?: TicketStatus;
  },
): Promise<{ ticketId: string; token: string }> {
  const ticketId = randomUUID();
  const tokenMaterial = ticketTokenService.generateAdmissionToken();

  await runtime.prisma.ticket.create({
    data: {
      id: ticketId,
      ticketNumber: ticketTokenService.generateTicketNumber(),
      eventId: input.eventId,
      organizerId: input.organizerId,
      ticketTypeId: input.ticketTypeId,
      ownerUserId: input.ownerUserId,
      status: input.status ?? TicketStatus.ISSUED,
      admissionTokenHash: tokenMaterial.hash,
      admissionTokenVersion: tokenMaterial.version,
      ticketSerial: `SER-${ticketId.slice(0, 8).toUpperCase()}`,
      publicReference: `GV-${ticketId.slice(0, 8).toUpperCase()}`,
      issuedAt: new Date('2026-06-01T12:30:00.000Z'),
    },
  });

  return {
    ticketId,
    token: tokenMaterial.token,
  };
}
