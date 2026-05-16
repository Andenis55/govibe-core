import { GatewayTimeoutException } from '@nestjs/common';
import { RequestContextService } from '../../../src/shared/context/request-context.service';
import { mapErrorToHttp } from '../../../src/shared/errors/http-error-mapper';
import { TransactionRunnerService } from '../../../src/shared/prisma/transaction-runner.service';
import { ProviderTimeoutError } from '../../../src/modules/payments/domain/providers/provider-errors';
import { VerifyPaymentUseCase } from '../../../src/modules/payments/application/use-cases/verify-payment.use-case';

describe('VerifyPaymentUseCase provider timeout reliability', () => {
  it('does not mutate payment state when provider verification times out', async () => {
    const requestContext = {
      get: jest.fn().mockReturnValue({
        requestId: 'req-1',
        correlationId: '2f4f2554-b7a6-4496-91e4-b5946c60b53d',
        userId: '84de56ff-640d-4f04-95d8-fd0a1c42d770',
      }),
    } as unknown as RequestContextService;
    const transactionRunner = {
      runInTransaction: jest.fn(),
    } as unknown as TransactionRunnerService;
    const paymentRepository = {
      findByProviderRef: jest.fn(),
      updateStatus: jest.fn(),
    };
    const ledgerRepository = {
      append: jest.fn(),
    };
    const orderRepository = {
      findById: jest.fn(),
      updateStatus: jest.fn(),
    };
    const auditLogRepository = {
      append: jest.fn(),
    };
    const outboxRepository = {
      append: jest.fn(),
    };
    const timeoutError = new ProviderTimeoutError('paystack', 'verification timed out');
    const paystackProvider = {
      verifyPayment: jest.fn().mockRejectedValue(timeoutError),
    };
    const momoProvider = {
      verifyPayment: jest.fn(),
    };

    const useCase = new VerifyPaymentUseCase(
      transactionRunner,
      requestContext,
      paymentRepository as never,
      ledgerRepository as never,
      paystackProvider as never,
      momoProvider as never,
      orderRepository as never,
      auditLogRepository as never,
      outboxRepository as never,
    );

    await expect(
      useCase.execute({
        provider: 'paystack',
        providerRef: 'provider-ref-1',
        verifiedSuccess: true,
        verifiedCurrency: 'GHS',
      }),
    ).rejects.toThrow('verification timed out');

    expect(transactionRunner.runInTransaction).not.toHaveBeenCalled();
    expect(paymentRepository.updateStatus).not.toHaveBeenCalled();
    expect(orderRepository.updateStatus).not.toHaveBeenCalled();
    expect(ledgerRepository.append).not.toHaveBeenCalled();

    const mapped = mapErrorToHttp(timeoutError);

    expect(mapped).toBeInstanceOf(GatewayTimeoutException);
    expect(mapped.getStatus()).toBe(504);
  });
});