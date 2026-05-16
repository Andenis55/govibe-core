import {
  AdmissionRejectionReason,
  AdmissionScanStatus,
} from '@prisma/client';
import { AdmissionsService } from '../../../src/modules/admissions/application/admissions.service';
import { ValidateAdmissionScanUseCase } from '../../../src/modules/admissions/application/use-cases/validate-admission-scan.use-case';

describe('ValidateAdmissionScanUseCase', () => {
  const admissionsService = {
    scanTicket: jest.fn(),
  } as unknown as jest.Mocked<Pick<AdmissionsService, 'scanTicket'>>;

  let useCase: ValidateAdmissionScanUseCase;

  beforeEach(() => {
    jest.clearAllMocks();

    useCase = new ValidateAdmissionScanUseCase(
      admissionsService as unknown as AdmissionsService,
    );
  });

  it('delegates the scan request to AdmissionsService and returns its accepted response', async () => {
    const scannedAt = new Date('2026-05-13T10:00:00.000Z');
    const input = {
      ticketId: 'ticket-1',
      token: 'signed-ticket-token-value-signed-ticket-token-value',
      scannedByUserId: 'scanner-1',
      eventId: 'event-1',
      deviceId: 'device-1',
      gateLabel: 'north-gate',
    };
    const response = {
      accepted: true,
      status: AdmissionScanStatus.ACCEPTED,
      rejectionReason: null,
      ticketId: 'ticket-1',
      scannedAt,
    };

    admissionsService.scanTicket.mockResolvedValue(response);

    await expect(useCase.execute(input)).resolves.toEqual(response);

    expect(admissionsService.scanTicket).toHaveBeenCalledWith(input);
  });

  it('returns rejected responses from AdmissionsService unchanged', async () => {
    const scannedAt = new Date('2026-05-13T10:05:00.000Z');
    const input = {
      ticketId: 'ticket-1',
      token: 'signed-ticket-token-value-signed-ticket-token-value',
      scannedByUserId: 'scanner-1',
    };
    const response = {
      accepted: false,
      status: AdmissionScanStatus.REJECTED,
      rejectionReason: AdmissionRejectionReason.TICKET_ALREADY_USED,
      ticketId: null,
      scannedAt,
    };

    admissionsService.scanTicket.mockResolvedValue(response);

    await expect(useCase.execute(input)).resolves.toEqual(response);

    expect(admissionsService.scanTicket).toHaveBeenCalledWith(input);
  });
});