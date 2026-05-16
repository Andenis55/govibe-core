import { OrderStatus, PaymentStatus } from '@prisma/client';
import { VerifyPaymentUseCase } from '../../../src/modules/payments/application/use-cases/verify-payment.use-case';
import { OrderRepository } from '../../../src/modules/orders/domain/repositories/order.repository.interface';
import { PaymentProvider } from '../../../src/modules/payments/domain/providers/payment-provider.interface';
import { LedgerRepository } from '../../../src/modules/payments/domain/repositories/ledger.repository.interface';
import { PaymentRepository } from '../../../src/modules/payments/domain/repositories/payment.repository.interface';
import { AuditLogRepositoryDouble } from '../../fixtures/doubles/audit-log-repository.double';
import { OutboxRepositoryDouble } from '../../fixtures/doubles/outbox-repository.double';
import { RequestContextDouble } from '../../fixtures/doubles/request-context.double';
import { TransactionRunnerDouble } from '../../fixtures/doubles/transaction-runner.double';

describe('VerifyPaymentUseCase', () => {
  let transactionRunner: TransactionRunnerDouble;
  let requestContext: RequestContextDouble;
  let paymentRepository: jest.Mocked<PaymentRepository>;
  let ledgerRepository: jest.Mocked<LedgerRepository>;
  let paystackProvider: jest.Mocked<PaymentProvider>;
  let momoProvider: jest.Mocked<PaymentProvider>;
  let orderRepository: jest.Mocked<OrderRepository>;
  let auditLogRepository: AuditLogRepositoryDouble;
  let outboxRepository: OutboxRepositoryDouble;
  let useCase: VerifyPaymentUseCase;

  beforeEach(() => {
    transactionRunner = new TransactionRunnerDouble();
    requestContext = new RequestContextDouble({
      correlationId: 'corr-1',
      requestId: 'req-1',
      userId: 'user-1',
    });
    paymentRepository = {
      create: jest.fn(),
      findByProviderRef: jest.fn(),
      findByOrderId: jest.fn(),
      updateStatus: jest.fn(),
    };
    ledgerRepository = {
      append: jest.fn(),
    };
    paystackProvider = {
      initiatePayment: jest.fn(),
      verifyPayment: jest.fn(),
      parseWebhook: jest.fn(),
    };
    momoProvider = {
      initiatePayment: jest.fn(),
      verifyPayment: jest.fn(),
      parseWebhook: jest.fn(),
    };
    orderRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      updateStatus: jest.fn(),
    };
    auditLogRepository = new AuditLogRepositoryDouble();
    outboxRepository = new OutboxRepositoryDouble();

    useCase = new VerifyPaymentUseCase(
      transactionRunner.asService(),
      requestContext.asService(),
      paymentRepository,
      ledgerRepository,
      paystackProvider,
      momoProvider,
      orderRepository,
      auditLogRepository,
      outboxRepository,
    );
  });

  it('updates payment and order and appends ledger once', async () => {
    paymentRepository.findByProviderRef.mockResolvedValue({
      id: 'payment-1',
      orderId: 'order-1',
      amount: BigInt(5000),
      status: PaymentStatus.PENDING,
    });
    orderRepository.findById.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      eventId: 'event-1',
      reservationId: 'reservation-1',
      status: OrderStatus.PAYMENT_PENDING,
      totalAmount: BigInt(5000),
      currency: 'GHS',
    });
    paystackProvider.verifyPayment.mockResolvedValue({
      providerRef: 'provider-ref-1',
      status: 'SUCCESS',
      amountMinor: BigInt(5000),
      currency: 'GHS',
      raw: {},
    });

    const result = await useCase.execute({
      provider: 'paystack',
      providerRef: 'provider-ref-1',
      verifiedSuccess: true,
      verifiedCurrency: 'GHS',
    });

    expect(paymentRepository.updateStatus).toHaveBeenCalledWith(
      'payment-1',
      PaymentStatus.SUCCESS,
      transactionRunner.client,
    );
    expect(orderRepository.updateStatus).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.PAID,
      transactionRunner.client,
    );
    expect(ledgerRepository.append).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentId: 'payment-1',
        orderId: 'order-1',
        amount: BigInt(5000),
        currency: 'GHS',
        correlationId: 'corr-1',
      }),
      transactionRunner.client,
    );
    expect(auditLogRepository.entries).toHaveLength(1);
    expect(outboxRepository.events).toHaveLength(1);
    expect(result.paymentStatus).toBe(PaymentStatus.SUCCESS);
    expect(result.orderStatus).toBe(OrderStatus.PAID);
  });

  it('rejects reprocessing of terminal payment state', async () => {
    paymentRepository.findByProviderRef.mockResolvedValue({
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.SUCCESS,
      amount: BigInt(5000),
    });
    paystackProvider.verifyPayment.mockResolvedValue({
      providerRef: 'provider-ref-1',
      status: 'SUCCESS',
      amountMinor: BigInt(5000),
      currency: 'GHS',
      raw: {},
    });

    await expect(
      useCase.execute({
        provider: 'paystack',
        providerRef: 'provider-ref-1',
        verifiedSuccess: true,
        verifiedCurrency: 'GHS',
      }),
    ).rejects.toThrow('Payment is already in terminal state.');

    expect(orderRepository.findById).not.toHaveBeenCalled();
    expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
    expect(ledgerRepository.append).not.toHaveBeenCalled();
    expect(auditLogRepository.entries).toHaveLength(0);
    expect(outboxRepository.events).toHaveLength(0);
  });

  it('marks failed verification without ledger credit append', async () => {
    paymentRepository.findByProviderRef.mockResolvedValue({
      id: 'payment-1',
      orderId: 'order-1',
      status: PaymentStatus.PENDING,
      amount: BigInt(5000),
    });
    orderRepository.findById.mockResolvedValue({
      id: 'order-1',
      userId: 'user-1',
      eventId: 'event-1',
      reservationId: 'reservation-1',
      status: OrderStatus.PAYMENT_PENDING,
      totalAmount: BigInt(5000),
      currency: 'GHS',
    });
    paystackProvider.verifyPayment.mockResolvedValue({
      providerRef: 'provider-ref-1',
      status: 'FAILED',
      amountMinor: BigInt(5000),
      currency: 'GHS',
      raw: {},
    });

    const result = await useCase.execute({
      provider: 'paystack',
      providerRef: 'provider-ref-1',
      verifiedSuccess: false,
      verifiedCurrency: 'GHS',
    });

    expect(result.paymentStatus).toBe(PaymentStatus.FAILED);
    expect(result.orderStatus).toBe(OrderStatus.FAILED);
    expect(paymentRepository.updateStatus).toHaveBeenCalledWith(
      'payment-1',
      PaymentStatus.FAILED,
      transactionRunner.client,
    );
    expect(orderRepository.updateStatus).toHaveBeenCalledWith(
      'order-1',
      OrderStatus.FAILED,
      transactionRunner.client,
    );
    expect(ledgerRepository.append).not.toHaveBeenCalled();
    expect(auditLogRepository.entries).toHaveLength(1);
    expect(outboxRepository.events).toHaveLength(1);
  });

  it('rejects when the verified webhook currency does not match provider verification', async () => {
    paystackProvider.verifyPayment.mockResolvedValue({
      providerRef: 'provider-ref-1',
      status: 'SUCCESS',
      amountMinor: BigInt(5000),
      currency: 'NGN',
      raw: {},
    });

    await expect(
      useCase.execute({
        provider: 'paystack',
        providerRef: 'provider-ref-1',
        verifiedSuccess: true,
        verifiedCurrency: 'GHS',
      }),
    ).rejects.toThrow('Webhook verification currency mismatch.');

    expect(paymentRepository.findByProviderRef).not.toHaveBeenCalled();
    expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
    expect(orderRepository.updateStatus).not.toHaveBeenCalled();
    expect(ledgerRepository.append).not.toHaveBeenCalled();
  });
});