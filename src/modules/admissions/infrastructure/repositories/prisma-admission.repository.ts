import { Injectable } from '@nestjs/common';
import {
  AdmissionRejectionReason,
  AdmissionScanStatus,
  AdmissionState,
  Prisma,
} from '@prisma/client';
import {
  RepositoryOptions,
  resolveDbClient,
  TxClient,
} from '../../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import { AdmissionRepository } from '../../domain/repositories/admission.repository.interface';

@Injectable()
export class PrismaAdmissionRepository implements AdmissionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async lockAdmissionState(ticketId: string, tx: TxClient) {
    const rows = await tx.$queryRaw<Array<{
      ticketId: string;
      currentState: AdmissionState;
      admissionCycleNo: number;
      lastEntryAt: Date | null;
      lastExitAt: Date | null;
      version: number;
    }>>(Prisma.sql`
      SELECT
        ticket_id AS "ticketId",
        current_state AS "currentState",
        admission_cycle_no AS "admissionCycleNo",
        last_entry_at AS "lastEntryAt",
        last_exit_at AS "lastExitAt",
        version
      FROM ticket_admission_state
      WHERE ticket_id = ${ticketId}::uuid
      FOR UPDATE
    `);

    return rows[0] ?? null;
  }

  async updateAdmissionStateWithVersion(
    input: {
      ticketId: string;
      currentState: AdmissionState;
      admissionCycleNo: number;
      lastEntryAt?: Date | null;
      lastExitAt?: Date | null;
      expectedVersion: number;
    },
    tx: TxClient,
  ): Promise<boolean> {
    const result = await tx.$executeRaw(Prisma.sql`
      UPDATE ticket_admission_state
      SET
        current_state = ${input.currentState}::admission_state,
        admission_cycle_no = ${input.admissionCycleNo},
        last_entry_at = ${input.lastEntryAt ?? null},
        last_exit_at = ${input.lastExitAt ?? null},
        version = version + 1
      WHERE ticket_id = ${input.ticketId}::uuid
        AND version = ${input.expectedVersion}
    `);

    return result === 1;
  }

  async appendScanAudit(
    input: {
      ticketId?: string | null;
      eventId?: string | null;
      organizerId?: string | null;
      scannedByUserId?: string | null;
      status: AdmissionScanStatus;
      rejectionReason?: AdmissionRejectionReason | null;
      tokenHash?: string | null;
      scanNonceHash?: string | null;
      deviceId?: string | null;
      gateLabel?: string | null;
      metadata?: Prisma.InputJsonValue | null;
      scannedAt: Date;
    },
    options?: RepositoryOptions,
  ): Promise<void> {
    const db = resolveDbClient(this.prisma, options);

    await db.admissionScanAudit.create({
      data: {
        ticketId: input.ticketId ?? null,
        eventId: input.eventId ?? null,
        organizerId: input.organizerId ?? null,
        scannedByUserId: input.scannedByUserId ?? null,
        status: input.status,
        rejectionReason: input.rejectionReason ?? null,
        tokenHash: input.tokenHash ?? null,
        scanNonceHash: input.scanNonceHash ?? null,
        deviceId: input.deviceId ?? null,
        gateLabel: input.gateLabel ?? null,
        metadata: input.metadata ?? Prisma.JsonNull,
        scannedAt: input.scannedAt,
      },
    });
  }
}