import { Injectable } from '@nestjs/common';
import { AdmissionsService, ScanTicketInput } from '../admissions.service';
import { AdmissionScanResponseDto } from '../../contracts/responses/admission-scan-response.dto';

export type ValidateAdmissionScanInput = ScanTicketInput;
export type ValidateAdmissionScanResult = AdmissionScanResponseDto;

@Injectable()
export class ValidateAdmissionScanUseCase {
  constructor(private readonly admissionsService: AdmissionsService) {}

  execute(input: ValidateAdmissionScanInput): Promise<ValidateAdmissionScanResult> {
    return this.admissionsService.scanTicket(input);
  }
}