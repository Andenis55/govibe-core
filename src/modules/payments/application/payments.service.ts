import { createHash } from 'node:crypto';
import { Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PaymentIntent, PaymentProvider, Prisma } from '@prisma/client';
import { EVENT_REPOSITORY } from '../../events/events.tokens';
import {
  EventRepository,
  PaymentInitiationEventRecord,
} from '../../events/domain/repositories/event.repository.interface';
import { RequestContextService } from '../../../shared/context/request-context.service';
import {
  DomainConflictError,
  IdempotencyConflictError,
  NotFoundError,
} from '../../../shared/errors/domain-errors';
import { LaunchControlService } from '../../../shared/launch-control/launch-control.service';
import {
  SupportedPaymentProvider,
} from '../../../shared/constants/payment.constants';
import { TransactionRunnerService } from '../../../shared/prisma/transaction-runner.service';
import { UsersService } from '../../../users/users.service';
import {
  MOMO_PROVIDER,
  PAYMENT_INTENT_AUDIT_LOG_REPOSITORY,
  PAYMENT_INTENT_REPOSITORY,
  PAYSTACK_PROVIDER,
} from '../payments.tokens';
import { PaymentProvider as PaymentProviderAdapter } from '../domain/providers/payment-provider.interface';
import {
  ProviderAuthError,
  ProviderNetworkError,
  ProviderResponseError,
  ProviderTimeoutError,
} from '../domain/providers/provider-errors';
import { PaymentIntentAuditLogRepository } from '../domain/repositories/payment-intent-audit-log.repository.interface';
import { PaymentIntentRepository } from '../domain/repositories/payment-intent.repository.interface';

export type InitiatePaymentInput = {
  idempotencyKey: string;
  eventId: string;
  provider: PaymentProvider;
  customerPhone?: string | null;
};

export type PaymentIntentView = {
  paymentIntentId: string;
  eventId: string;
  organizerId: string;
  buyerUserId: string;
  provider: PaymentProvider;
  status: PaymentIntent['status'];
  amountMinor: number;
  currency: string;
  providerReference: string;
  providerCheckoutUrl: string | null;
  providerAccessCode: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  initiatedAt: Date | null;
  verifiedAt: Date | null;
  failedAt: Date | null;
  providerVerifiedStatus: string | null;
  providerVerifiedAmount: number | null;
  providerVerifiedCurrency: string | null;
};

const PAYMENT_INITIATION_IDEMPOTENCY_USE_CASE = 'payments.initiate';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly transactionRunner: TransactionRunnerService,
    private readonly requestContext: RequestContextService,
    private readonly launchControl: LaunchControlService,
    private readonly usersService: UsersService,
    @Inject(EVENT_REPOSITORY)
    private readonly eventRepository: EventRepository,
    @Inject(PAYMENT_INTENT_REPOSITORY)
    private readonly paymentIntentRepository: PaymentIntentRepository,
    @Inject(PAYMENT_INTENT_AUDIT_LOG_REPOSITORY)
    private readonly paymentIntentAuditLogRepository: PaymentIntentAuditLogRepository,
    @Inject(PAYSTACK_PROVIDER)
    private readonly paystackProvider: PaymentProviderAdapter,
    @Inject(MOMO_PROVIDER)
    private readonly momoProvider: PaymentProviderAdapter,
  ) {}

  async initiatePayment(input: InitiatePaymentInput): Promise<PaymentIntentView> {
    const ctx = this.requestContext.get();

    if (!ctx?.userId) {
      throw new DomainConflictError('Authenticated user context is required.');
    }

    const buyer = await this.usersService.findById(ctx.userId);

    if (!buyer) {
      throw new NotFoundError('Buyer not found.');
    }

    if (!buyer.isActive) {
      throw new DomainConflictError('Inactive users cannot initiate payments.');
    }

    if (!buyer.emailVerifiedAt) {
      throw new DomainConflictError(
        'Email verification is required before initiating payments.',
      );
    }

    const event = await this.eventRepository.findByIdForPaymentInitiation(input.eventId);
    this.assertEventEligible(event, input.eventId);

    await this.launchControl.assertPaymentInitiationAllowed({
      provider: this.toSupportedProvider(input.provider),
      eventId: event.id,
      currency: event.priceCurrency,
    });

    const amountMinor = event.priceMinor!;

    const idempotencyKeyHash = this.hashValue(input.idempotencyKey);
    const requestFingerprintHash = this.hashValue(
      JSON.stringify({
        eventId: input.eventId,
        provider: input.provider,
        customerPhone: this.normalizePhone(input.customerPhone),
      }),
    );

    const action = await this.transactionRunner.runInTransaction(async (tx) => {
      const existing = await this.paymentIntentRepository.findByBuyerAndIdempotency(
        {
          buyerUserId: buyer.id,
          idempotencyUseCase: PAYMENT_INITIATION_IDEMPOTENCY_USE_CASE,
          idempotencyKeyHash,
        },
        { tx },
      );

      if (existing) {
        if (existing.requestFingerprintHash !== requestFingerprintHash) {
          throw new IdempotencyConflictError(
            'Idempotency key reused with different payload.',
          );
        }

        if (existing.status === 'INITIATION_FAILED') {
          const retried = await this.paymentIntentRepository.markRetryPending(
            existing.id,
            { tx },
          );

          await this.paymentIntentAuditLogRepository.append(
            {
              paymentIntentId: retried.id,
              buyerUserId: buyer.id,
              eventType: 'payment_initiation_requested',
              data: this.toJsonValue({
                retry: true,
                eventId: event.id,
                organizerId: event.organizerId,
                provider: input.provider,
              }),
            },
            { tx },
          );

          return { kind: 'call-provider' as const, paymentIntent: retried };
        }

        await this.paymentIntentAuditLogRepository.append(
          {
            paymentIntentId: existing.id,
            buyerUserId: buyer.id,
            eventType: 'payment_initiation_idempotent_replay',
            data: this.toJsonValue({
              eventId: existing.eventId,
              provider: existing.provider,
              status: existing.status,
            }),
          },
          { tx },
        );

        return { kind: 'return-existing' as const, paymentIntent: existing };
      }

      const created = await this.paymentIntentRepository.create(
        {
          buyerUserId: buyer.id,
          organizerId: event.organizerId,
          eventId: event.id,
          provider: input.provider,
          status: 'INITIATION_PENDING',
          amountMinor,
          currency: event.priceCurrency,
          idempotencyUseCase: PAYMENT_INITIATION_IDEMPOTENCY_USE_CASE,
          idempotencyKeyHash,
          requestFingerprintHash,
          providerReference: this.buildProviderReference(idempotencyKeyHash),
        },
        { tx },
      );

      await this.paymentIntentAuditLogRepository.append(
        {
          paymentIntentId: created.id,
          buyerUserId: buyer.id,
          eventType: 'payment_initiation_requested',
          data: this.toJsonValue({
            eventId: event.id,
            organizerId: event.organizerId,
            provider: input.provider,
          }),
        },
        { tx },
      );

      return { kind: 'call-provider' as const, paymentIntent: created };
    });

    if (action.kind === 'return-existing') {
      return this.toView(action.paymentIntent);
    }

    const adapter = this.resolveProvider(input.provider);
    const paymentIntent = action.paymentIntent;

    try {
      const initiated = await adapter.initiate({
        paymentIntentId: paymentIntent.id,
        providerReference: paymentIntent.providerReference,
        amountMinor: paymentIntent.amountMinor,
        currency: paymentIntent.currency,
        customerEmail: buyer.email,
        customerPhone: this.normalizePhone(input.customerPhone),
        metadata: {
          paymentIntentId: paymentIntent.id,
          eventId: paymentIntent.eventId,
          organizerId: paymentIntent.organizerId,
          buyerUserId: paymentIntent.buyerUserId,
        },
      });

      if (initiated.providerReference !== paymentIntent.providerReference) {
        throw new ProviderResponseError(
          this.toProviderCode(input.provider),
          'PAYMENT_PROVIDER_REFERENCE_MISMATCH',
          500,
          'Provider returned an unexpected payment reference.',
        );
      }

      try {
        const persisted = await this.transactionRunner.runInTransaction(async (tx) => {
          const updated = await this.paymentIntentRepository.markInitiated(
            {
              paymentIntentId: paymentIntent.id,
              providerCheckoutUrl: initiated.checkoutUrl ?? null,
              providerAccessCode: initiated.accessCode ?? null,
              providerRawResponse: this.toJsonValue(initiated.rawResponse),
              initiatedAt: new Date(),
            },
            { tx },
          );

          await this.paymentIntentAuditLogRepository.append(
            {
              paymentIntentId: updated.id,
              buyerUserId: buyer.id,
              eventType: 'payment_initiation_initiated',
              data: this.toJsonValue({
                provider: updated.provider,
                providerReference: updated.providerReference,
                providerCheckoutUrl: updated.providerCheckoutUrl,
                providerAccessCode: updated.providerAccessCode,
              }),
            },
            { tx },
          );

          return updated;
        });

        return this.toView(persisted);
      } catch (error) {
        await this.recordProviderSuccessPersistenceFailure(
          paymentIntent,
          buyer.id,
          initiated.rawResponse,
          error,
        );

        throw new InternalServerErrorException(
          'Payment provider initiation succeeded but local persistence failed.',
        );
      }
    } catch (error) {
      await this.recordInitiationFailure(paymentIntent, buyer.id, input.provider, error);
      throw error;
    }
  }

  async getPaymentIntentForBuyer(
    paymentIntentId: string,
    buyerUserId: string,
  ): Promise<PaymentIntentView> {
    const paymentIntent = await this.paymentIntentRepository.findOwnedByBuyer({
      paymentIntentId,
      buyerUserId,
    });

    if (!paymentIntent) {
      throw new NotFoundError('Payment intent not found.');
    }

    return this.toView(paymentIntent);
  }

  private assertEventEligible(
    event: PaymentInitiationEventRecord | null,
    eventId: string,
  ): asserts event is PaymentInitiationEventRecord {
    if (!event) {
      throw new NotFoundError('Event not found.');
    }

    if (event.status !== 'PUBLISHED') {
      throw new DomainConflictError('Event is not published.');
    }

    if (event.organizer.status !== 'APPROVED') {
      throw new DomainConflictError('Organizer is not approved for payments.');
    }

    if (!event.paymentEnabled) {
      throw new DomainConflictError('Event is not enabled for payments.');
    }

    if (!event.priceMinor || event.priceMinor <= 0) {
      throw new DomainConflictError(
        `Event ${eventId} does not have a valid payment amount configured.`,
      );
    }

    if (!event.priceCurrency.trim()) {
      throw new DomainConflictError(
        `Event ${eventId} does not have a valid payment currency configured.`,
      );
    }
  }

  private resolveProvider(provider: PaymentProvider): PaymentProviderAdapter {
    switch (provider) {
      case PaymentProvider.PAYSTACK:
        return this.paystackProvider;
      case PaymentProvider.MTN_MOMO:
        return this.momoProvider;
      default:
        throw new NotFoundError(`Unsupported payment provider: ${provider}`);
    }
  }

  private async recordInitiationFailure(
    paymentIntent: PaymentIntent,
    buyerUserId: string,
    provider: PaymentProvider,
    error: unknown,
  ): Promise<void> {
    const failureCode = this.resolveFailureCode(error);
    const failureMessage = error instanceof Error ? error.message : 'Payment initiation failed.';
    const providerRawResponse = this.resolveFailurePayload(error);

    await this.transactionRunner.runInTransaction(async (tx) => {
      await this.paymentIntentRepository.markFailed(
        {
          paymentIntentId: paymentIntent.id,
          failureCode,
          failureMessage,
          providerRawResponse,
          failedAt: new Date(),
        },
        { tx },
      );

      await this.paymentIntentAuditLogRepository.append(
        {
          paymentIntentId: paymentIntent.id,
          buyerUserId,
          eventType: 'payment_initiation_failed',
          data: this.toJsonValue({
            provider,
            providerReference: paymentIntent.providerReference,
            failureCode,
            failureMessage,
          }),
        },
        { tx },
      );
    });
  }

  private async recordProviderSuccessPersistenceFailure(
    paymentIntent: PaymentIntent,
    buyerUserId: string,
    rawResponse: Record<string, unknown>,
    error: unknown,
  ): Promise<void> {
    try {
      await this.transactionRunner.runInTransaction(async (tx) => {
        await this.paymentIntentRepository.markFailed(
          {
            paymentIntentId: paymentIntent.id,
            failureCode: 'LOCAL_PERSISTENCE_FAILURE_AFTER_PROVIDER_SUCCESS',
            failureMessage:
              'Provider initiation succeeded but the local state could not be finalized.',
            providerRawResponse: this.toJsonValue(rawResponse),
            failedAt: new Date(),
          },
          { tx },
        );

        await this.paymentIntentAuditLogRepository.append(
          {
            paymentIntentId: paymentIntent.id,
            buyerUserId,
            eventType: 'payment_initiation_provider_created_db_update_failed',
            data: this.toJsonValue({
              providerReference: paymentIntent.providerReference,
              error: error instanceof Error ? error.message : 'Unknown persistence error',
            }),
          },
          { tx },
        );
      });
    } catch {
      await this.tryAppendAuditLog({
        paymentIntentId: paymentIntent.id,
        buyerUserId,
        eventType: 'payment_initiation_provider_created_db_update_failed',
        data: this.toJsonValue({
          providerReference: paymentIntent.providerReference,
          error: error instanceof Error ? error.message : 'Unknown persistence error',
          auditFallback: true,
        }),
      });
    }
  }

  private async tryAppendAuditLog(input: {
    paymentIntentId: string;
    buyerUserId: string;
    eventType: string;
    data: Prisma.InputJsonValue;
  }): Promise<void> {
    try {
      await this.paymentIntentAuditLogRepository.append(input);
    } catch {
      // Best effort only at this consistency boundary.
    }
  }

  private toSupportedProvider(provider: PaymentProvider): SupportedPaymentProvider {
    return provider === PaymentProvider.PAYSTACK ? 'paystack' : 'momo';
  }

  private toProviderCode(provider: PaymentProvider): string {
    return provider === PaymentProvider.PAYSTACK ? 'paystack' : 'momo';
  }

  private normalizePhone(value: string | null | undefined): string | null {
    const normalized = value?.trim();

    return normalized ? normalized : null;
  }

  private buildProviderReference(idempotencyKeyHash: string): string {
    return `pi_${idempotencyKeyHash.slice(0, 24)}`;
  }

  private hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private resolveFailureCode(error: unknown): string {
    if (error instanceof ProviderTimeoutError) {
      return 'PAYMENT_PROVIDER_TIMEOUT';
    }

    if (error instanceof ProviderAuthError) {
      return 'PAYMENT_PROVIDER_AUTH_ERROR';
    }

    if (error instanceof ProviderNetworkError) {
      return 'PAYMENT_PROVIDER_NETWORK_ERROR';
    }

    if (error instanceof ProviderResponseError) {
      return error.code;
    }

    return 'PAYMENT_INITIATION_FAILED';
  }

  private resolveFailurePayload(
    error: unknown,
  ): Prisma.InputJsonValue | null {
    if (error instanceof ProviderResponseError && error.metadata) {
      return this.toJsonValue(error.metadata);
    }

    if (error instanceof Error) {
      return this.toJsonValue({
        name: error.name,
        message: error.message,
      });
    }

    return null;
  }

  private toView(paymentIntent: PaymentIntent): PaymentIntentView {
    return {
      paymentIntentId: paymentIntent.id,
      eventId: paymentIntent.eventId,
      organizerId: paymentIntent.organizerId,
      buyerUserId: paymentIntent.buyerUserId,
      provider: paymentIntent.provider,
      status: paymentIntent.status,
      amountMinor: paymentIntent.amountMinor,
      currency: paymentIntent.currency,
      providerReference: paymentIntent.providerReference,
      providerCheckoutUrl: paymentIntent.providerCheckoutUrl ?? null,
      providerAccessCode: paymentIntent.providerAccessCode ?? null,
      failureCode: paymentIntent.failureCode ?? null,
      failureMessage: paymentIntent.failureMessage ?? null,
      createdAt: paymentIntent.createdAt,
      updatedAt: paymentIntent.updatedAt,
      initiatedAt: paymentIntent.initiatedAt ?? null,
      verifiedAt: paymentIntent.verifiedAt ?? null,
      failedAt: paymentIntent.failedAt ?? null,
      providerVerifiedStatus: paymentIntent.providerVerifiedStatus ?? null,
      providerVerifiedAmount: paymentIntent.providerVerifiedAmount ?? null,
      providerVerifiedCurrency: paymentIntent.providerVerifiedCurrency ?? null,
    };
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}