import {
  AdmissionDirection,
  AdmissionEventResult,
} from '@prisma/client';
import { TxClient } from '../../../../shared/prisma/prisma.types';

export interface AdmissionEventRepository {
  append(
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
  ): Promise<void>;
}
