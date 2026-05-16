import { AdmissionRejectionReason, AdmissionScanStatus } from '@prisma/client';

export class AdminAdmissionAuditResponseDto {
  id!: string;
  ticketId!: string | null;
  eventId!: string | null;
  organizerId!: string | null;
  scannedByUserId!: string | null;
  status!: AdmissionScanStatus;
  rejectionReason!: AdmissionRejectionReason | null;
  deviceId!: string | null;
  gateLabel!: string | null;
  scannedAt!: Date;
}
