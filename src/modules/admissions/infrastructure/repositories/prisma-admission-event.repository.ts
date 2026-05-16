import { Injectable } from '@nestjs/common';
import {
  AdmissionDirection,
  AdmissionEventResult,
} from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';
import { AdmissionEventRepository } from '../../domain/repositories/admission-event.repository.interface';

@Injectable()
export class PrismaAdmissionEventRepository implements AdmissionEventRepository {
  async append(
    input: {
      id: string;
      scanEventId?: string | null;
      ticketId: string;
      admissionCycleNo: number;
      direction: AdmissionDirection;
      result: AdmissionEventResult;
      scannedAt: Date;
      gateId?: string | null;
    },
    tx: TxClient,
  ): Promise<void> {
    await tx.admissionEvent.create({
      data: {
        id: input.id,
        scanEventId: input.scanEventId,
        ticketId: input.ticketId,
        admissionCycleNo: input.admissionCycleNo,
        direction: input.direction,
        result: input.result,
        scannedAt: input.scannedAt,
        gateId: input.gateId,
      },
    });
  }
}