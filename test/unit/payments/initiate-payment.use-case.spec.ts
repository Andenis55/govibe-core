import { createHash } from 'node:crypto';
import {
  OrganizerStatus,
  PaymentIntent,
  PaymentIntentStatus,
  PaymentProvider,
} from '@prisma/client';
import { IdempotencyConflictError } from '../../../src/shared/errors/domain-errors';
import { PaymentsService } from '../../../src/modules/payments/application/payments.service';
import { PaymentProvider as PaymentProviderAdapter } from '../../../src/modules/payments/domain/providers/payment-provider.interface';
import { PaymentIntentAuditLogRepository } from '../../../src/modules/payments/domain/repositories/payment-intent-audit-log.repository.interface';
import { PaymentIntentRepository } from '../../../src/modules/payments/domain/repositories/payment-intent.repository.interface';
import {
  EventRepository,
  PaymentInitiationEventRecord,
} from '../../../src/modules/events/domain/repositories/event.repository.interface';
import { UsersService } from '../../../src/users/users.service';
import { LaunchControlDouble } from '../../fixtures/doubles/launch-control.double';
import { RequestContextDouble } from '../../fixtures/doubles/request-context.double';
import { TransactionRunnerDouble } from '../../fixtures/doubles/transaction-runner.double';

describe('PaymentsService', () => {
  let transactionRunner: TransactionRunnerDouble;
  let requestContext: RequestContextDouble;
  let launchControl: LaunchControlDouble;
  let usersService: jest.Mocked<Pick<UsersService, 'findById'>>;
  let eventRepository: jest.Mocked<Pick<EventRepository, 'findByIdForPaymentInitiation'>>;
  let paymentIntentRepository: jest.Mocked<PaymentIntentRepository>;
  let paymentIntentAuditLogRepository: jest.Mocked<PaymentIntentAuditLogRepository>;
  let paystackProvider: jest.Mocked<PaymentProviderAdapter>;
  let momoProvider: jest.Mocked<PaymentProviderAdapter>;
  let service: PaymentsService;

  beforeEach(() => {
    transactionRunner = new TransactionRunnerDouble();
    requestContext = new RequestContextDouble({
      userId: 'user-1',
      correlationId: 'corr-1',
    });
    launchControl = new LaunchControlDouble();
    usersService = {
      findById: jest.fn(),
    };
    eventRepository = {
      findByIdForPaymentInitiation: jest.fn(),
    };
    paymentIntentRepository = {
      findByBuyerAndIdempotency: jest.fn(),
      findOwnedByBuyer: jest.fn(),
      create: jest.fn(),
      markRetryPending: jest.fn(),
      markInitiated: jest.fn(),
      markFailed: jest.fn(),
    } as jest.Mocked<PaymentIntentRepository>;
    paymentIntentAuditLogRepository = {
      append: jest.fn(),
    } as jest.Mocked<PaymentIntentAuditLogRepository>;
    paystackProvider = createProviderDouble(PaymentProvider.PAYSTACK);
    momoProvider = createProviderDouble(PaymentProvider.MTN_MOMO);

    service = new PaymentsService(
      transactionRunner.asService(),
      requestContext.asService(),
      launchControl.asService(),
      usersService as unknown as UsersService,
      eventRepository as unknown as EventRepository,
      paymentIntentRepository,
      paymentIntentAuditLogRepository,
      paystackProvider,
      momoProvider,
    );

    usersService.findById.mockResolvedValue({
      id: 'user-1',
      email: 'buyer@example.com',
      isActive: true,
      emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    } as never);
    eventRepository.findByIdForPaymentInitiation.mockResolvedValue(
      createEventRecord(),
    );
  });

  it('returns an existing pending intent for the same buyer, key, and payload without re-calling the provider', async () => {
    const input = {
      idempotencyKey: 'shared-key',
      eventId: 'event-1',
      provider: PaymentProvider.PAYSTACK,
      customerPhone: '+233555000111',
    };
    const existingIntent = createPaymentIntent({
      status: PaymentIntentStatus.INITIATION_PENDING,
      requestFingerprintHash: createRequestFingerprint(input),
    });

    paymentIntentRepository.findByBuyerAndIdempotency.mockResolvedValue(existingIntent);

    const result = await service.initiatePayment(input);

    expect(result.paymentIntentId).toBe(existingIntent.id);
    expect(result.status).toBe(PaymentIntentStatus.INITIATION_PENDING);
    expect(paystackProvider.initiate).not.toHaveBeenCalled();
    expect(paymentIntentAuditLogRepository.append).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: existingIntent.id,
        eventType: 'payment_initiation_idempotent_replay',
      }),
      { tx: transactionRunner.client },
    );
  });

  it('rejects idempotency key reuse when the payload fingerprint changes', async () => {
    const input = {
      idempotencyKey: 'shared-key',
      eventId: 'event-1',
      provider: PaymentProvider.PAYSTACK,
      customerPhone: '+233555000111',
    };

    paymentIntentRepository.findByBuyerAndIdempotency.mockResolvedValue(
      createPaymentIntent({
        status: PaymentIntentStatus.INITIATION_PENDING,
        requestFingerprintHash: createRequestFingerprint({
          ...input,
          customerPhone: '+233000000000',
        }),
      }),
    );

    await expect(service.initiatePayment(input)).rejects.toThrow(
      IdempotencyConflictError,
    );
    expect(paystackProvider.initiate).not.toHaveBeenCalled();
  });

  it('retries a failed intent with the same key and marks it initiated on provider success', async () => {
    const input = {
      idempotencyKey: 'shared-key',
      eventId: 'event-1',
      provider: PaymentProvider.PAYSTACK,
      customerPhone: '+233555000111',
    };
    const failedIntent = createPaymentIntent({
      status: PaymentIntentStatus.INITIATION_FAILED,
      requestFingerprintHash: createRequestFingerprint(input),
    });
    const retryPendingIntent = {
      ...failedIntent,
      status: PaymentIntentStatus.INITIATION_PENDING,
      failureCode: null,
      failureMessage: null,
      failedAt: null,
    };
    const initiatedIntent = {
      ...retryPendingIntent,
      status: PaymentIntentStatus.INITIATED,
      providerCheckoutUrl: 'https://example.com/pay',
      providerAccessCode: 'access-code-1',
      initiatedAt: new Date('2026-01-01T00:00:02.000Z'),
    };

    paymentIntentRepository.findByBuyerAndIdempotency.mockResolvedValue(failedIntent);
    paymentIntentRepository.markRetryPending.mockResolvedValue(retryPendingIntent);
    paymentIntentRepository.markInitiated.mockResolvedValue(initiatedIntent);
    paystackProvider.initiate.mockResolvedValue({
      providerReference: failedIntent.providerReference,
      checkoutUrl: 'https://example.com/pay',
      accessCode: 'access-code-1',
      rawResponse: {},
    });

    const result = await service.initiatePayment(input);

    expect(paymentIntentRepository.markRetryPending).toHaveBeenCalledWith(
      failedIntent.id,
      { tx: transactionRunner.client },
    );
    expect(paystackProvider.initiate).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(PaymentIntentStatus.INITIATED);
    expect(result.providerReference).toBe(failedIntent.providerReference);
  });
});

function createProviderDouble(
  provider: PaymentProvider,
): jest.Mocked<PaymentProviderAdapter> {
  const initiate: jest.MockedFunction<PaymentProviderAdapter['initiate']> = jest.fn();
  const initiatePayment: jest.MockedFunction<
    PaymentProviderAdapter['initiatePayment']
  > = jest.fn();
  const verifyPayment: jest.MockedFunction<
    PaymentProviderAdapter['verifyPayment']
  > = jest.fn();
  const parseWebhook: jest.MockedFunction<
    PaymentProviderAdapter['parseWebhook']
  > = jest.fn();

  return {
    provider,
    initiate,
    initiatePayment,
    verifyPayment,
    parseWebhook,
  };
}

function createEventRecord(): PaymentInitiationEventRecord {
  return {
    id: 'event-1',
    organizerId: 'organizer-1',
    venueId: 'venue-1',
    title: 'Test Event',
    slug: 'test-event',
    description: null,
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    category: 'CONCERT',
    startsAt: new Date('2026-06-01T20:00:00.000Z'),
    endsAt: new Date('2026-06-01T23:00:00.000Z'),
    timezone: 'Africa/Accra',
    venueName: 'Accra Hall',
    addressLine1: null,
    addressLine2: null,
    city: 'Accra',
    region: null,
    country: 'Ghana',
    latitude: null,
    longitude: null,
    capacityTotal: 100,
    capacityHeld: 0,
    paymentEnabled: true,
    priceMinor: 5000,
    priceCurrency: 'GHS',
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    cancelledAt: null,
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    organizer: {
      id: 'organizer-1',
      ownerUserId: 'user-1',
      displayName: 'Test Organizer',
      slug: 'test-organizer',
      description: null,
      status: OrganizerStatus.APPROVED,
      contactEmail: null,
      contactPhone: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  } as PaymentInitiationEventRecord;
}

function createPaymentIntent(input: {
  status: PaymentIntentStatus;
  requestFingerprintHash: string;
}): PaymentIntent {
  return {
    id: 'payment-intent-1',
    buyerUserId: 'user-1',
    organizerId: 'organizer-1',
    eventId: 'event-1',
    provider: PaymentProvider.PAYSTACK,
    status: input.status,
    amountMinor: 5000,
    currency: 'GHS',
    idempotencyUseCase: 'payments.initiate',
    idempotencyKeyHash: createHash('sha256').update('shared-key').digest('hex'),
    requestFingerprintHash: input.requestFingerprintHash,
    providerReference: 'pi_reference_1',
    providerCheckoutUrl: null,
    providerAccessCode: null,
    providerRawResponse: null,
    failureCode: input.status === PaymentIntentStatus.INITIATION_FAILED ? 'PAYMENT_PROVIDER_TIMEOUT' : null,
    failureMessage:
      input.status === PaymentIntentStatus.INITIATION_FAILED
        ? 'Provider timed out.'
        : null,
    initiatedAt: null,
    failedAt:
      input.status === PaymentIntentStatus.INITIATION_FAILED
        ? new Date('2026-01-01T00:00:01.000Z')
        : null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as PaymentIntent;
}

function createRequestFingerprint(input: {
  eventId: string;
  provider: PaymentProvider;
  customerPhone?: string | null;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        eventId: input.eventId,
        provider: input.provider,
        customerPhone: input.customerPhone ?? null,
      }),
    )
    .digest('hex');
}
