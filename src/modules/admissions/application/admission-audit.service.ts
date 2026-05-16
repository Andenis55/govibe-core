import { Inject, Injectable } from '@nestjs/common';
import {
  AdmissionRejectionReason,
  AdmissionScanStatus,
  Prisma,
} from '@prisma/client';
import { RepositoryOptions } from '../../../shared/prisma/prisma.types';
import { ADMISSION_REPOSITORY } from '../admissions.tokens';
import { AdmissionRepository } from '../domain/repositories/admission.repository.interface';

@Injectable()
export class AdmissionAuditService {
  constructor(
    @Inject(ADMISSION_REPOSITORY)
    private readonly admissionRepository: AdmissionRepository,
  ) {}

  record(
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
    return this.admissionRepository.appendScanAudit(input, options);
  }
}