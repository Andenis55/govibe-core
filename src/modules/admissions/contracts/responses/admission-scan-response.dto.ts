import {
  AdmissionRejectionReason,
  AdmissionScanStatus,
} from '@prisma/client';

export class AdmissionScanResponseDto {
  accepted!: boolean;
  status!: AdmissionScanStatus;
  rejectionReason!: AdmissionRejectionReason | null;
  ticketId!: string | null;
  scannedAt!: Date;
}