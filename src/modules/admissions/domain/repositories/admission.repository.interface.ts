import {
  AdmissionRejectionReason,
  AdmissionScanStatus,
  AdmissionState,
  Prisma,
} from '@prisma/client';
import {
  RepositoryOptions,
  TxClient,
} from '../../../../shared/prisma/prisma.types';

export interface AdmissionRepository {
  lockAdmissionState(
    ticketId: string,
    tx: TxClient,
  ): Promise<{
    ticketId: string;
    currentState: AdmissionState;
    admissionCycleNo: number;
    lastEntryAt: Date | null;
    lastExitAt: Date | null;
    version: number;
  } | null>;

  updateAdmissionStateWithVersion(
    input: {
      ticketId: string;
      currentState: AdmissionState;
      admissionCycleNo: number;
      lastEntryAt?: Date | null;
      lastExitAt?: Date | null;
      expectedVersion: number;
    },
    tx: TxClient,
  ): Promise<boolean>;

  appendScanAudit(
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
  ): Promise<void>;
}
