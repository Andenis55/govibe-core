import { ProviderAuthError, ProviderTimeoutError } from '../../../src/modules/payments/domain/providers/provider-errors';
import { OutboxProcessor } from '../../../src/shared/outbox/outbox.processor';

describe('OutboxProcessor', () => {
  const claimRepository = {
    claimBatch: jest.fn(),
    markProcessed: jest.fn(),
    markFailure: jest.fn(),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
  };
  const telemetry = {
    record: jest.fn(),
  };
  const dispatcher = {
    dispatch: jest.fn(),
  };

  let processor: OutboxProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new OutboxProcessor(
      claimRepository as never,
      logger as never,
      telemetry as never,
      dispatcher as never,
    );
  });

  it('reschedules retryable dispatch failures', async () => {
    claimRepository.claimBatch.mockResolvedValue([
      {
        id: 'event-1',
        aggregateType: 'payment',
        aggregateId: 'payment-1',
        eventType: 'PaymentVerifiedSuccess',
        payload: { paymentId: 'payment-1' },
        retryCount: 0,
      },
    ]);
    dispatcher.dispatch.mockRejectedValue(
      new ProviderTimeoutError('paystack', 'Timed out'),
    );

    const processed = await processor.processBatch();

    expect(processed).toBe(1);
    expect(claimRepository.markFailure).toHaveBeenCalledWith('event-1', {
      retryCount: 1,
      errorCode: 'ProviderTimeoutError',
      retryable: true,
    });
    expect(claimRepository.markProcessed).not.toHaveBeenCalled();
  });

  it('dead-letters non-retryable dispatch failures', async () => {
    claimRepository.claimBatch.mockResolvedValue([
      {
        id: 'event-2',
        aggregateType: 'payment',
        aggregateId: 'payment-2',
        eventType: 'PaymentVerifiedSuccess',
        payload: { paymentId: 'payment-2' },
        retryCount: 0,
      },
    ]);
    dispatcher.dispatch.mockRejectedValue(
      new ProviderAuthError('paystack', 'Unauthorized'),
    );

    await processor.processBatch();

    expect(claimRepository.markFailure).toHaveBeenCalledWith('event-2', {
      retryCount: 1,
      errorCode: 'ProviderAuthError',
      retryable: false,
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('dead-lettered'),
      OutboxProcessor.name,
    );
  });
});