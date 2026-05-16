import { LaunchControlDisabledError, LaunchControlViolationError } from '../../../../src/shared/errors/domain-errors';
import { LaunchControlService } from '../../../../src/shared/launch-control/launch-control.service';
import { PrismaService } from '../../../../src/shared/prisma/prisma.service';

const eventFindUnique = jest.fn();
const gateFindUnique = jest.fn();

describe('LaunchControlService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    eventFindUnique.mockResolvedValue({
      id: 'event-1',
      organizerId: 'organizer-1',
      venueId: 'venue-1',
    });
    gateFindUnique.mockResolvedValue({
      id: 'gate-1',
      venueId: 'venue-1',
    });
  });

  it('allows checkout when no pilot controls are configured', async () => {
    const service = createService();

    await expect(
      service.assertCheckoutAllowed({
        eventId: 'event-1',
        currency: 'GHS',
      }),
    ).resolves.toBeUndefined();
  });

  it('blocks payment initiation when the payments kill switch is off', async () => {
    const service = createService({
      PILOT_PAYMENTS_ENABLED: false,
    });

    await expect(
      service.assertPaymentInitiationAllowed({
        provider: 'paystack',
        eventId: 'event-1',
        currency: 'GHS',
      }),
    ).rejects.toBeInstanceOf(LaunchControlDisabledError);
    expect(eventFindUnique).not.toHaveBeenCalled();
  });

  it('blocks payment initiation outside the provider or currency allowlist', async () => {
    const service = createService({
      PILOT_ALLOWED_PAYMENT_PROVIDERS: ['paystack'],
      PILOT_ALLOWED_CURRENCIES: ['GHS'],
    });

    await expect(
      service.assertPaymentInitiationAllowed({
        provider: 'momo',
        eventId: 'event-1',
        currency: 'GHS',
      }),
    ).rejects.toBeInstanceOf(LaunchControlViolationError);

    await expect(
      service.assertPaymentInitiationAllowed({
        provider: 'paystack',
        eventId: 'event-1',
        currency: 'NGN',
      }),
    ).rejects.toBeInstanceOf(LaunchControlViolationError);
  });

  it('blocks admission scans outside the gate allowlist', async () => {
    const service = createService({
      PILOT_ALLOWED_GATE_IDS: ['gate-allowed'],
    });

    await expect(
      service.assertAdmissionValidationAllowed({
        eventId: 'event-1',
        gateId: 'gate-1',
      }),
    ).rejects.toBeInstanceOf(LaunchControlViolationError);
  });
});

function createService(config: Record<string, unknown> = {}): LaunchControlService {
  return new LaunchControlService(
    {
      getOptional: jest.fn((key: string) => config[key]),
    } as never,
    {
      event: {
        findUnique: eventFindUnique,
      },
      gate: {
        findUnique: gateFindUnique,
      },
    } as unknown as PrismaService,
  );
}