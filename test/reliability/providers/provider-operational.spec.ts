import { createHash } from 'node:crypto';
import { OrderStatus, PaymentIntentStatus, PaymentStatus } from '@prisma/client';
import request = require('supertest');
import { ProviderTimeoutError } from '../../../src/modules/payments/domain/providers/provider-errors';
import { VerifyPaymentUseCase } from '../../../src/modules/payments/application/use-cases/verify-payment.use-case';
import {
  ContainerRuntimeUnavailableError,
  createOperationalRuntime,
  OperationalRuntime,
  TEST_AUTH_IDENTITIES,
} from '../../setup/operational-runtime';
import { seedEventInventory } from '../../setup/seed-data';
import { getTestGlobals } from '../../setup/test-globals';

describe('payment provider operational reliability', () => {
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

  it('does not mutate payment or order state when verification times out', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedEventInventory(runtime.prisma, {
      userId: TEST_AUTH_IDENTITIES.customer.userId,
      userEmail: TEST_AUTH_IDENTITIES.customer.email,
    });
    const globals = getTestGlobals();
    const verifyPayment = globals.__CONTAINER__?.resolve(
      'VerifyPaymentUseCase',
    ) as VerifyPaymentUseCase;

    await runtime.prisma.order.create({
      data: {
        id: '82000000-0000-4000-8000-000000000001',
        userId: TEST_AUTH_IDENTITIES.customer.userId,
        eventId: seeded.eventId,
        status: OrderStatus.PAYMENT_PENDING,
        totalAmount: BigInt(12000),
        currency: 'GHS',
      },
    });
    await runtime.prisma.payment.create({
      data: {
        id: '82000000-0000-4000-8000-000000000002',
        orderId: '82000000-0000-4000-8000-000000000001',
        provider: 'paystack',
        providerRef: 'timeout-ref-1',
        status: PaymentStatus.PENDING,
        amount: BigInt(12000),
      },
    });

    jest
      .spyOn(globals.__PAYSTACK_PROVIDER__!, 'verifyPayment')
      .mockRejectedValueOnce(
        new ProviderTimeoutError('paystack', 'Paystack verification timed out.'),
      );

    await expect(
      verifyPayment.execute({
        provider: 'paystack',
        providerRef: 'timeout-ref-1',
        verifiedSuccess: false,
        verifiedCurrency: 'GHS',
      }),
    ).rejects.toThrow('Paystack verification timed out.');

    const payment = await runtime.prisma.payment.findUnique({
      where: { id: '82000000-0000-4000-8000-000000000002' },
    });
    const order = await runtime.prisma.order.findUnique({
      where: { id: '82000000-0000-4000-8000-000000000001' },
    });
    const ledgerEntries = await runtime.prisma.ledgerEntry.findMany({
      where: { paymentId: '82000000-0000-4000-8000-000000000002' },
    });

    expect(payment?.status).toBe(PaymentStatus.PENDING);
    expect(order?.status).toBe(OrderStatus.PAYMENT_PENDING);
    expect(ledgerEntries).toHaveLength(0);
  });

  it('allows a safe retry after a transient verification timeout', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedEventInventory(runtime.prisma, {
      userId: TEST_AUTH_IDENTITIES.customer.userId,
      userEmail: TEST_AUTH_IDENTITIES.customer.email,
    });
    const globals = getTestGlobals();
    const verifyPayment = globals.__CONTAINER__?.resolve(
      'VerifyPaymentUseCase',
    ) as VerifyPaymentUseCase;

    await runtime.prisma.order.create({
      data: {
        id: '82000000-0000-4000-8000-000000000011',
        userId: TEST_AUTH_IDENTITIES.customer.userId,
        eventId: seeded.eventId,
        status: OrderStatus.PAYMENT_PENDING,
        totalAmount: BigInt(12000),
        currency: 'GHS',
      },
    });
    await runtime.prisma.payment.create({
      data: {
        id: '82000000-0000-4000-8000-000000000012',
        orderId: '82000000-0000-4000-8000-000000000011',
        provider: 'paystack',
        providerRef: 'timeout-ref-retry-1',
        status: PaymentStatus.PENDING,
        amount: BigInt(12000),
      },
    });

    jest
      .spyOn(globals.__PAYSTACK_PROVIDER__!, 'verifyPayment')
      .mockRejectedValueOnce(
        new ProviderTimeoutError('paystack', 'Paystack verification timed out.'),
      )
      .mockResolvedValueOnce({
        providerRef: 'timeout-ref-retry-1',
        status: 'SUCCESS',
        amountMinor: BigInt(12000),
        currency: 'GHS',
        raw: {},
      });

    await expect(
      verifyPayment.execute({
        provider: 'paystack',
        providerRef: 'timeout-ref-retry-1',
        verifiedSuccess: false,
        verifiedCurrency: 'GHS',
      }),
    ).rejects.toThrow('Paystack verification timed out.');

    const result = await verifyPayment.execute({
      provider: 'paystack',
      providerRef: 'timeout-ref-retry-1',
      verifiedSuccess: true,
      verifiedCurrency: 'GHS',
    });

    expect(result.paymentStatus).toBe(PaymentStatus.SUCCESS);
    expect(result.orderStatus).toBe(OrderStatus.PAID);
    expect(
      await runtime.prisma.ledgerEntry.count({
        where: { paymentId: '82000000-0000-4000-8000-000000000012' },
      }),
    ).toBe(1);
  });

  it('returns 504 on initiation timeout and allows a safe retry with the same idempotency key', async () => {
    if (!runtime) {
      return;
    }

    const seeded = await seedEventInventory(runtime.prisma, {
      userId: TEST_AUTH_IDENTITIES.customer.userId,
      userEmail: TEST_AUTH_IDENTITIES.customer.email,
    });

    const expectedProviderReference = `pi_${createHash('sha256')
      .update('provider-timeout-init-1')
      .digest('hex')
      .slice(0, 24)}`;

    jest
      .spyOn(getTestGlobals().__PAYSTACK_PROVIDER__!, 'initiatePayment')
      .mockRejectedValueOnce(
        new ProviderTimeoutError('paystack', 'Paystack request timed out.'),
      )
      .mockResolvedValueOnce({
        providerReference: expectedProviderReference,
        checkoutUrl: 'https://example.com/pay',
        accessCode: 'access-timeout-init-1',
        rawResponse: {},
      });

    await request(runtime.app.getHttpServer())
      .post('/payments/initiate')
      .set('Authorization', `Bearer ${runtime.tokens.customer}`)
      .set('Idempotency-Key', 'provider-timeout-init-1')
      .send({
        eventId: seeded.eventId,
        provider: 'PAYSTACK',
      })
      .expect(504);

    await request(runtime.app.getHttpServer())
      .post('/payments/initiate')
      .set('Authorization', `Bearer ${runtime.tokens.customer}`)
      .set('Idempotency-Key', 'provider-timeout-init-1')
      .send({
        eventId: seeded.eventId,
        provider: 'PAYSTACK',
      })
      .expect(201);

    const paymentIntents = await runtime.prisma.paymentIntent.findMany({
      where: {
        buyerUserId: TEST_AUTH_IDENTITIES.customer.userId,
        eventId: seeded.eventId,
      },
    });
    const audits = await runtime.prisma.paymentIntentAuditLog.findMany({
      where: {
        paymentIntentId: paymentIntents[0]?.id,
      },
    });

    expect(paymentIntents).toHaveLength(1);
    expect(paymentIntents[0]?.status).toBe(PaymentIntentStatus.INITIATED);
    expect(paymentIntents[0]?.providerReference).toBe(expectedProviderReference);
    expect(audits.map((audit) => audit.eventType)).toEqual(
      expect.arrayContaining([
        'payment_initiation_requested',
        'payment_initiation_failed',
        'payment_initiation_initiated',
      ]),
    );
  });
});