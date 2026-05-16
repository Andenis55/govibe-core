import { OutboxProcessor } from '../../../src/shared/outbox/outbox.processor';
import { ProviderTimeoutError } from '../../../src/modules/payments/domain/providers/provider-errors';
import {
  ContainerRuntimeUnavailableError,
  createOperationalRuntime,
  OperationalRuntime,
} from '../../setup/operational-runtime';
import { getTestGlobals } from '../../setup/test-globals';

describe('outbox operational reliability', () => {
  let runtime: OperationalRuntime | null = null;

  beforeAll(async () => {
    try {
      runtime = await createOperationalRuntime();
    } catch (error) {
      if (error instanceof ContainerRuntimeUnavailableError) {
        return;
      }

      throw error;
    }
  });

  afterAll(async () => {
    if (runtime) {
      await runtime.dispose();
    }
  });

  it('reschedules retryable dispatch failures', async () => {
    if (!runtime) {
      return;
    }

    const globals = getTestGlobals();
    const processor = globals.__CONTAINER__?.resolve(
      'OutboxProcessor',
    ) as OutboxProcessor;

    await runtime.prisma.outboxEvent.create({
      data: {
        id: '83000000-0000-4000-8000-000000000001',
        aggregateType: 'order',
        aggregateId: '83000000-0000-4000-8000-000000000002',
        eventType: 'OrderCreated',
        payload: { orderId: '83000000-0000-4000-8000-000000000002' },
        processed: false,
        retryCount: 0,
      },
    });

    globals.__OUTBOX_DISPATCHER__?.dispatch.mockRejectedValueOnce(
      new ProviderTimeoutError('dispatcher', 'temporary network failure'),
    );

    const processedCount = await processor.processBatch();
    const row = await runtime.prisma.outboxEvent.findUnique({
      where: { id: '83000000-0000-4000-8000-000000000001' },
    });

    expect(processedCount).toBe(1);
    expect(row?.processed).toBe(false);
    expect(row?.retryCount).toBe(1);
    expect(row?.deadLetteredAt).toBeNull();
    expect(row?.nextAttemptAt).toBeTruthy();
  });

  it('dead-letters non-retryable dispatch failures', async () => {
    if (!runtime) {
      return;
    }

    const globals = getTestGlobals();
    const processor = globals.__CONTAINER__?.resolve(
      'OutboxProcessor',
    ) as OutboxProcessor;

    await runtime.prisma.outboxEvent.create({
      data: {
        id: '83000000-0000-4000-8000-000000000003',
        aggregateType: 'payment',
        aggregateId: '83000000-0000-4000-8000-000000000004',
        eventType: 'PaymentVerifiedSuccess',
        payload: { paymentId: '83000000-0000-4000-8000-000000000004' },
        processed: false,
        retryCount: 0,
      },
    });

    globals.__OUTBOX_DISPATCHER__?.dispatch.mockRejectedValueOnce(
      Object.assign(new Error('invalid payload'), {
        name: 'ValidationError',
      }),
    );

    await processor.processBatch();

    const row = await runtime.prisma.outboxEvent.findUnique({
      where: { id: '83000000-0000-4000-8000-000000000003' },
    });

    expect(row?.processed).toBe(false);
    expect(row?.deadLetteredAt).toBeTruthy();
    expect(row?.lastErrorCode).toBe('ValidationError');
    expect(row?.nextAttemptAt).toBeNull();
  });

  it('marks an event processed after a later successful retry', async () => {
    if (!runtime) {
      return;
    }

    const globals = getTestGlobals();
    const processor = globals.__CONTAINER__?.resolve(
      'OutboxProcessor',
    ) as OutboxProcessor;

    await runtime.prisma.outboxEvent.create({
      data: {
        id: '83000000-0000-4000-8000-000000000005',
        aggregateType: 'ticket',
        aggregateId: '83000000-0000-4000-8000-000000000006',
        eventType: 'TicketsIssued',
        payload: { orderId: '83000000-0000-4000-8000-000000000007' },
        processed: false,
        retryCount: 1,
        nextAttemptAt: new Date(Date.now() - 1000),
      },
    });

    globals.__OUTBOX_DISPATCHER__?.dispatch.mockResolvedValueOnce(undefined);

    await processor.processBatch();

    const row = await runtime.prisma.outboxEvent.findUnique({
      where: { id: '83000000-0000-4000-8000-000000000005' },
    });

    expect(row?.processed).toBe(true);
    expect(row?.processedAt).toBeTruthy();
    expect(row?.lastErrorCode).toBeNull();
    expect(row?.deadLetteredAt).toBeNull();
  });
});