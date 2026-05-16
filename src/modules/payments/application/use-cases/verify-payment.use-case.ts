import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  LedgerDirection,
  OrderStatus,
  PaymentStatus,
  Prisma,
} from '@prisma/client';

import { AUDIT_LOG_REPOSITORY } from '../../../audit/audit.tokens';
import { AuditLogRepository } from '../../../audit/domain/repositories/audit-log.repository.interface';
import { ORDER_REPOSITORY } from '../../../orders/orders.tokens';
import { OrderRepository } from '../../../orders/domain/repositories/order.repository.interface';
import {
  LEDGER_REPOSITORY,
  MOMO_PROVIDER,
  PAYMENT_REPOSITORY,
  PAYSTACK_PROVIDER,
} from '../../payments.tokens';
import { LedgerRepository } from '../../domain/repositories/ledger.repository.interface';
import { PaymentRepository } from '../../domain/repositories/payment.repository.interface';
import { PaymentProvider } from '../../domain/providers/payment-provider.interface';
import { RequestContextService } from '../../../../shared/context/request-context.service';
import {
  InvalidStateTransitionError,
  NotFoundError,
  PaymentAlreadyProcessedError,
} from '../../../../shared/errors/domain-errors';
import { OutboxRepository } from '../../../../shared/outbox/outbox.repository.interface';
import { OUTBOX_REPOSITORY } from '../../../../shared/outbox/outbox.tokens';
import { TransactionRunnerService } from '../../../../shared/prisma/transaction-runner.service';
import {
  SupportedCurrency,
  SupportedPaymentProvider,
} from '../../../../shared/constants/payment.constants';

export type VerifyPaymentInput = {
  provider: SupportedPaymentProvider;
  providerRef: string;
  verifiedSuccess: boolean;
  verifiedCurrency: SupportedCurrency | string;
};

export type VerifyPaymentResult = {
  paymentId: string;
  orderId: string;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
};

@Injectable()
export class VerifyPaymentUseCase {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly requestContext: RequestContextService,
    @Inject(PAYMENT_REPOSITORY)
    private readonly paymentRepository: PaymentRepository,
    @Inject(LEDGER_REPOSITORY)
    private readonly ledgerRepository: LedgerRepository,
    @Inject(PAYSTACK_PROVIDER)
    private readonly paystackProvider: PaymentProvider,
    @Inject(MOMO_PROVIDER)
    private readonly momoProvider: PaymentProvider,
    @Inject(ORDER_REPOSITORY)
    private readonly orderRepository: OrderRepository,
    @Inject(AUDIT_LOG_REPOSITORY)
    private readonly auditLogRepository: AuditLogRepository,
    @Inject(OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepository,
  ) {}

  async execute(input: VerifyPaymentInput): Promise<VerifyPaymentResult> {
    const ctx = this.requestContext.get();
    const provider = this.resolveProvider(input.provider);
    const verification = await provider.verifyPayment(input.providerRef);

    if (verification.currency !== input.verifiedCurrency) {
      throw new InvalidStateTransitionError(
        'Webhook verification currency mismatch.',
      );
    }

    if (input.verifiedSuccess && verification.status !== 'SUCCESS') {
      throw new InvalidStateTransitionError(
        'Webhook success state does not match provider verification.',
      );
    }

    return this.transactionRunner.runInTransaction(
      async (tx) => {
        const payment = await this.paymentRepository.findByProviderRef(
          input.provider,
          input.providerRef,
          tx,
        );

        if (!payment) {
          throw new NotFoundError('Payment not found.');
        }

        if (
          payment.status === PaymentStatus.SUCCESS ||
          payment.status === PaymentStatus.REFUNDED ||
          payment.status === PaymentStatus.REVERSED
        ) {
          throw new PaymentAlreadyProcessedError(
            'Payment is already in terminal state.',
          );
        }

        const order = await this.orderRepository.findById(payment.orderId, tx);

        if (!order) {
          throw new NotFoundError('Order not found.');
        }

        if (
          verification.amountMinor !== payment.amount ||
          verification.currency !== order.currency
        ) {
          throw new InvalidStateTransitionError(
            'Provider verification does not match expected payment amount or currency.',
          );
        }

        const newPaymentStatus = this.mapProviderStatus(verification.status);

        await this.paymentRepository.updateStatus(payment.id, newPaymentStatus, tx);

        const newOrderStatus = this.mapOrderStatus(newPaymentStatus);

        await this.orderRepository.updateStatus(payment.orderId, newOrderStatus, tx);

        if (newPaymentStatus === PaymentStatus.SUCCESS) {
          await this.ledgerRepository.append(
            {
              id: randomUUID(),
              orderId: payment.orderId,
              paymentId: payment.id,
              direction: LedgerDirection.CREDIT,
              accountType: 'CUSTOMER_CASH_IN',
              amount: verification.amountMinor,
              currency: verification.currency,
              correlationId: ctx?.correlationId,
            },
            tx,
          );
        }

        await this.auditLogRepository.append(
          {
            id: randomUUID(),
            actorId: ctx?.userId ?? null,
            action: 'PAYMENT_VERIFIED',
            entityType: 'payment',
            entityId: payment.id,
            correlationId: ctx?.correlationId,
            metadata: {
              provider: input.provider,
              providerRef: input.providerRef,
              providerStatus: verification.status,
              orderId: payment.orderId,
            },
          },
          tx,
        );

        await this.outboxRepository.append(
          {
            id: randomUUID(),
            aggregateType: 'payment',
            aggregateId: payment.id,
            eventType:
              newPaymentStatus === PaymentStatus.SUCCESS
                ? 'PaymentVerifiedSuccess'
                : newPaymentStatus === PaymentStatus.PENDING
                  ? 'PaymentVerificationPending'
                  : 'PaymentVerifiedFailure',
            payload: {
              paymentId: payment.id,
              orderId: payment.orderId,
              provider: input.provider,
              providerStatus: verification.status,
            },
          },
          tx,
        );

        return {
          paymentId: payment.id,
          orderId: payment.orderId,
          paymentStatus: newPaymentStatus,
          orderStatus: newOrderStatus,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );
  }

  private resolveProvider(provider: SupportedPaymentProvider): PaymentProvider {
    if (provider === 'paystack') {
      return this.paystackProvider;
    }

    return this.momoProvider;
  }

  private mapProviderStatus(
    status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'REFUNDED',
  ): PaymentStatus {
    switch (status) {
      case 'SUCCESS':
        return PaymentStatus.SUCCESS;
      case 'FAILED':
        return PaymentStatus.FAILED;
      case 'REVERSED':
        return PaymentStatus.REVERSED;
      case 'REFUNDED':
        return PaymentStatus.REFUNDED;
      default:
        return PaymentStatus.PENDING;
    }
  }

  private mapOrderStatus(status: PaymentStatus): OrderStatus {
    switch (status) {
      case PaymentStatus.SUCCESS:
        return OrderStatus.PAID;
      case PaymentStatus.PENDING:
        return OrderStatus.PAYMENT_PENDING;
      default:
        return OrderStatus.FAILED;
    }
  }
}
