import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  PaymentIntent,
  PaymentIntentStatus,
  PaymentProvider,
  Prisma,
  ProviderWebhookEvent,
  WebhookProcessingStatus,
} from '@prisma/client';
import { AppConfigService } from '../../../shared/config/config.service';
import { SupportedPaymentProvider } from '../../../shared/constants/payment.constants';
import {
  ProviderAuthError,
  ProviderNetworkError,
  ProviderResponseError,
  ProviderTimeoutError,
  WebhookSignatureError,
} from '../domain/providers/provider-errors';
import { PaymentIntentAuditLogRepository } from '../domain/repositories/payment-intent-audit-log.repository.interface';
import { PaymentIntentRepository } from '../domain/repositories/payment-intent.repository.interface';
import { ProviderWebhookEventRepository } from '../domain/repositories/provider-webhook-event.repository.interface';
import {
  PAYMENT_INTENT_AUDIT_LOG_REPOSITORY,
  PAYMENT_INTENT_REPOSITORY,
  PROVIDER_WEBHOOK_EVENT_REPOSITORY,
} from '../payments.tokens';
import { ProviderVerificationRegistry } from '../verification/provider-verification.registry';
import { ProviderVerificationResult } from '../verification/provider-verification.types';
import {
  WebhookHeaders,
  WebhookSignatureService,
} from '../webhooks/webhook-signature.service';
import { TransactionRunnerService } from '../../../shared/prisma/transaction-runner.service';

export type PaymentWebhookInput = {
  provider: SupportedPaymentProvider;
  rawBody: Buffer;
  parsedBody: unknown;
  headers: WebhookHeaders;
};

export type PaymentWebhookResult = {
  acknowledged: true;
  paymentIntentId: string | null;
  processingStatus: WebhookProcessingStatus;
};

type ParsedWebhookEnvelope = {
  provider: PaymentProvider;
  payloadHash: string;
  rawPayload: string;
  rawHeaders: Record<string, string | string[]>;
  providerEventId: string;
  providerReference: string | null;
  eventType: string | null;
  signatureValid: boolean | null;
  verifiedPayload: Record<string, unknown> | null;
  supported: boolean;
};

@Injectable()
export class PaymentVerificationService {
  constructor(
    private readonly configService: AppConfigService,
    private readonly transactionRunner: TransactionRunnerService,
    private readonly verificationRegistry: ProviderVerificationRegistry,
    private readonly webhookSignatureService: WebhookSignatureService,
    @Inject(PAYMENT_INTENT_REPOSITORY)
    private readonly paymentIntentRepository: PaymentIntentRepository,
    @Inject(PAYMENT_INTENT_AUDIT_LOG_REPOSITORY)
    private readonly paymentIntentAuditLogRepository: PaymentIntentAuditLogRepository,
    @Inject(PROVIDER_WEBHOOK_EVENT_REPOSITORY)
    private readonly providerWebhookEventRepository: ProviderWebhookEventRepository,
  ) {}

  async handleWebhook(input: PaymentWebhookInput): Promise<PaymentWebhookResult> {
    const provider = this.resolveProvider(input.provider);
    const payloadHash = this.webhookSignatureService.computePayloadHash(
      input.rawBody,
    );
    const rawPayload = input.rawBody.toString('utf8');
    const rawHeaders = this.webhookSignatureService.toJsonHeaders(input.headers);

    if (provider === PaymentProvider.PAYSTACK) {
      const validation = this.webhookSignatureService.validatePaystackSignature(
        input.rawBody,
        input.headers,
        String(this.configService.getOrThrow('PAYSTACK_SECRET_KEY')),
      );

      if (!validation.valid) {
        await this.persistRejectedSignatureEvent({
          provider,
          payloadHash,
          rawPayload,
          rawHeaders,
          failureMessage: validation.failureMessage ?? 'Invalid Paystack signature.',
        });

        throw new WebhookSignatureError(
          'paystack',
          validation.failureMessage ?? 'Invalid Paystack webhook signature.',
        );
      }

      const parsed = this.parsePaystackEnvelope(
        input.parsedBody,
        payloadHash,
        rawPayload,
        rawHeaders,
      );

      return this.processEnvelope(parsed);
    }

    const parsed = this.parseMomoEnvelope(
      input.parsedBody,
      payloadHash,
      rawPayload,
      rawHeaders,
    );

    return this.processEnvelope(parsed);
  }

  private async processEnvelope(
    envelope: ParsedWebhookEnvelope,
  ): Promise<PaymentWebhookResult> {
    const paymentIntent = envelope.providerReference
      ? await this.paymentIntentRepository.findByProviderReference(
          envelope.providerReference,
        )
      : null;

    const created = await this.createWebhookEvent(envelope, paymentIntent);

    if (!created.created) {
      return this.handleDuplicateDelivery(
        created.event,
        paymentIntent,
        envelope,
      );
    }

    const webhookEvent = created.event;

    if (paymentIntent) {
      await this.paymentIntentAuditLogRepository.append({
        paymentIntentId: paymentIntent.id,
        buyerUserId: paymentIntent.buyerUserId,
        eventType: 'payment_webhook_received',
        data: this.toJsonValue({
          provider: envelope.provider,
          providerEventId: envelope.providerEventId,
          providerReference: envelope.providerReference,
          processingStatus: webhookEvent.processingStatus,
        }),
      });
    }

    if (!envelope.supported) {
      await this.markWebhookProcessed(webhookEvent, paymentIntent, {
        eventType: 'payment_webhook_unsupported_event_ignored',
        data: {
          eventType: envelope.eventType,
          providerReference: envelope.providerReference,
        },
      });

      return this.toResult(webhookEvent.id, paymentIntent?.id ?? null, WebhookProcessingStatus.PROCESSED);
    }

    if (!envelope.providerReference) {
      await this.rejectWebhook(webhookEvent, paymentIntent, {
        failureCode: 'MISSING_PROVIDER_REFERENCE',
        failureMessage: 'Webhook payload did not include a provider reference.',
      });

      return this.toResult(webhookEvent.id, null, WebhookProcessingStatus.REJECTED);
    }

    if (!paymentIntent) {
      await this.rejectWebhook(webhookEvent, paymentIntent, {
        failureCode: 'PAYMENT_INTENT_NOT_FOUND',
        failureMessage: 'Payment intent could not be found for the provider reference.',
      });

      return this.toResult(webhookEvent.id, null, WebhookProcessingStatus.REJECTED);
    }

    if (paymentIntent.provider !== envelope.provider) {
      await this.rejectWebhook(webhookEvent, paymentIntent, {
        failureCode: 'PROVIDER_MISMATCH',
        failureMessage: 'Webhook provider does not match payment intent provider.',
        auditEventType: 'payment_verification_provider_mismatch',
        auditData: {
          expectedProvider: paymentIntent.provider,
          actualProvider: envelope.provider,
          providerReference: paymentIntent.providerReference,
        },
      });

      return this.toResult(
        webhookEvent.id,
        paymentIntent.id,
        WebhookProcessingStatus.REJECTED,
      );
    }

    await this.paymentIntentAuditLogRepository.append({
      paymentIntentId: paymentIntent.id,
      buyerUserId: paymentIntent.buyerUserId,
      eventType: 'payment_verification_started',
      data: this.toJsonValue({
        provider: paymentIntent.provider,
        providerReference: paymentIntent.providerReference,
        webhookEventId: webhookEvent.id,
      }),
    });

    let verification: ProviderVerificationResult;

    try {
      verification = await this.verificationRegistry
        .get(envelope.provider)
        .verifyByReference(envelope.providerReference);
    } catch (error) {
      return this.handleVerificationError(webhookEvent, paymentIntent, error);
    }

    return this.handleVerificationResult(webhookEvent, paymentIntent, verification);
  }

  private async handleDuplicateDelivery(
    webhookEvent: ProviderWebhookEvent,
    paymentIntent: PaymentIntent | null,
    envelope: ParsedWebhookEnvelope,
  ): Promise<PaymentWebhookResult> {
    const duplicateIntent = paymentIntent ??
      (webhookEvent.paymentIntentId
        ? await this.paymentIntentRepository.findById(webhookEvent.paymentIntentId)
        : null);

    if (duplicateIntent) {
      await this.paymentIntentAuditLogRepository.append({
        paymentIntentId: duplicateIntent.id,
        buyerUserId: duplicateIntent.buyerUserId,
        eventType: 'payment_webhook_duplicate',
        data: this.toJsonValue({
          provider: envelope.provider,
          providerEventId: envelope.providerEventId,
          payloadHash: envelope.payloadHash,
        }),
      });
    }

    return {
      acknowledged: true,
      paymentIntentId: duplicateIntent?.id ?? null,
      processingStatus: WebhookProcessingStatus.DUPLICATE,
    };
  }

  private async handleVerificationError(
    webhookEvent: ProviderWebhookEvent,
    paymentIntent: PaymentIntent,
    error: unknown,
  ): Promise<PaymentWebhookResult> {
    const failureCode = this.resolveVerificationFailureCode(error);
    const failureMessage =
      error instanceof Error ? error.message : 'Payment verification failed.';

    await this.transactionRunner.runInTransaction(
      async (tx) => {
        await this.providerWebhookEventRepository.updateProcessing(
          {
            webhookEventId: webhookEvent.id,
            processingStatus: WebhookProcessingStatus.FAILED,
            paymentIntentId: paymentIntent.id,
            providerReference: paymentIntent.providerReference,
            failureCode,
            failureMessage,
            processedAt: new Date(),
          },
          { tx },
        );

        await this.paymentIntentAuditLogRepository.append(
          {
            paymentIntentId: paymentIntent.id,
            buyerUserId: paymentIntent.buyerUserId,
            eventType: 'payment_verification_failed',
            data: this.toJsonValue({
              provider: paymentIntent.provider,
              providerReference: paymentIntent.providerReference,
              failureCode,
              failureMessage,
            }),
          },
          { tx },
        );
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10000,
      },
    );

    return {
      acknowledged: true,
      paymentIntentId: paymentIntent.id,
      processingStatus: WebhookProcessingStatus.FAILED,
    };
  }

  private async handleVerificationResult(
    webhookEvent: ProviderWebhookEvent,
    paymentIntent: PaymentIntent,
    verification: ProviderVerificationResult,
  ): Promise<PaymentWebhookResult> {
    if (verification.providerReference !== paymentIntent.providerReference) {
      await this.rejectWebhook(webhookEvent, paymentIntent, {
        failureCode: 'PAYMENT_VERIFICATION_REFERENCE_MISMATCH',
        failureMessage: 'Provider verification reference did not match payment intent reference.',
        auditEventType: 'payment_verification_reference_mismatch',
        auditData: {
          expectedReference: paymentIntent.providerReference,
          actualReference: verification.providerReference,
          providerStatus: verification.providerStatus,
        },
      });

      return this.toResult(
        webhookEvent.id,
        paymentIntent.id,
        WebhookProcessingStatus.REJECTED,
      );
    }

    if (verification.amountMinor !== paymentIntent.amountMinor) {
      await this.rejectWebhook(webhookEvent, paymentIntent, {
        failureCode: 'PAYMENT_VERIFICATION_AMOUNT_MISMATCH',
        failureMessage: 'Provider verification amount did not match payment intent amount.',
        auditEventType: 'payment_verification_amount_mismatch',
        auditData: {
          expectedAmountMinor: paymentIntent.amountMinor,
          actualAmountMinor: verification.amountMinor,
          providerStatus: verification.providerStatus,
        },
      });

      return this.toResult(
        webhookEvent.id,
        paymentIntent.id,
        WebhookProcessingStatus.REJECTED,
      );
    }

    if (verification.currency !== paymentIntent.currency) {
      await this.rejectWebhook(webhookEvent, paymentIntent, {
        failureCode: 'PAYMENT_VERIFICATION_CURRENCY_MISMATCH',
        failureMessage: 'Provider verification currency did not match payment intent currency.',
        auditEventType: 'payment_verification_currency_mismatch',
        auditData: {
          expectedCurrency: paymentIntent.currency,
          actualCurrency: verification.currency,
          providerStatus: verification.providerStatus,
        },
      });

      return this.toResult(
        webhookEvent.id,
        paymentIntent.id,
        WebhookProcessingStatus.REJECTED,
      );
    }

    if (verification.status === 'SUCCESS') {
      return this.applyTerminalTransition({
        paymentIntent,
        webhookEvent,
        verification,
        targetStatus: PaymentIntentStatus.VERIFIED,
      });
    }

    if (verification.status === 'FAILED') {
      return this.applyTerminalTransition({
        paymentIntent,
        webhookEvent,
        verification,
        targetStatus: PaymentIntentStatus.FAILED,
      });
    }

    await this.markWebhookProcessed(webhookEvent, paymentIntent, {
      eventType: 'payment_verification_pending',
      data: {
        providerStatus: verification.providerStatus,
        providerReference: paymentIntent.providerReference,
      },
    });

    return {
      acknowledged: true,
      paymentIntentId: paymentIntent.id,
      processingStatus: WebhookProcessingStatus.PROCESSED,
    };
  }

  private async applyTerminalTransition(input: {
    paymentIntent: PaymentIntent;
    webhookEvent: ProviderWebhookEvent;
    verification: ProviderVerificationResult;
    targetStatus: 'VERIFIED' | 'FAILED';
  }): Promise<PaymentWebhookResult> {
    const now = new Date();
    const verificationRaw = this.toJsonValue(input.verification.rawResponse);

    return this.transactionRunner.runInTransaction(
      async (tx) => {
        const transitionCount =
          input.targetStatus === PaymentIntentStatus.VERIFIED
            ? await this.paymentIntentRepository.transitionToVerified(
                {
                  paymentIntentId: input.paymentIntent.id,
                  verifiedAt: now,
                  providerVerifiedStatus: input.verification.providerStatus,
                  providerVerifiedAmount: input.verification.amountMinor,
                  providerVerifiedCurrency: input.verification.currency,
                  providerVerificationRaw: verificationRaw,
                },
                { tx },
              )
            : await this.paymentIntentRepository.transitionToFailed(
                {
                  paymentIntentId: input.paymentIntent.id,
                  failedAt: now,
                  failureCode: 'PROVIDER_PAYMENT_FAILED',
                  failureMessage: `Provider reported ${input.verification.providerStatus}.`,
                  providerVerifiedStatus: input.verification.providerStatus,
                  providerVerifiedAmount: input.verification.amountMinor,
                  providerVerifiedCurrency: input.verification.currency,
                  providerVerificationRaw: verificationRaw,
                },
                { tx },
              );

        if (transitionCount !== 1) {
          const current = await this.paymentIntentRepository.findById(
            input.paymentIntent.id,
            { tx },
          );

          const isAlreadyProcessed =
            current?.status === PaymentIntentStatus.VERIFIED &&
            input.targetStatus === PaymentIntentStatus.VERIFIED;

          await this.paymentIntentAuditLogRepository.append(
            {
              paymentIntentId: input.paymentIntent.id,
              buyerUserId: input.paymentIntent.buyerUserId,
              eventType: isAlreadyProcessed
                ? 'payment_status_transition_skipped_already_processed'
                : 'payment_status_transition_rejected',
              data: this.toJsonValue({
                currentStatus: current?.status ?? null,
                attemptedStatus: input.targetStatus,
                reason: 'status_guard_prevented_duplicate_transition',
              }),
            },
            { tx },
          );

          await this.providerWebhookEventRepository.updateProcessing(
            {
              webhookEventId: input.webhookEvent.id,
              paymentIntentId: input.paymentIntent.id,
              providerReference: input.paymentIntent.providerReference,
              processingStatus: WebhookProcessingStatus.PROCESSED,
              processedAt: now,
            },
            { tx },
          );

          return {
            acknowledged: true,
            paymentIntentId: input.paymentIntent.id,
            processingStatus: WebhookProcessingStatus.PROCESSED,
          };
        }

        await this.paymentIntentAuditLogRepository.append(
          {
            paymentIntentId: input.paymentIntent.id,
            buyerUserId: input.paymentIntent.buyerUserId,
            eventType:
              input.targetStatus === PaymentIntentStatus.VERIFIED
                ? 'payment_verification_succeeded'
                : 'payment_verification_failed',
            data: this.toJsonValue({
              providerStatus: input.verification.providerStatus,
              providerReference: input.paymentIntent.providerReference,
            }),
          },
          { tx },
        );

        await this.paymentIntentAuditLogRepository.append(
          {
            paymentIntentId: input.paymentIntent.id,
            buyerUserId: input.paymentIntent.buyerUserId,
            eventType:
              input.targetStatus === PaymentIntentStatus.VERIFIED
                ? 'payment_status_transition_verified'
                : 'payment_status_transition_failed',
            data: this.toJsonValue({
              previousStatus: input.paymentIntent.status,
              newStatus: input.targetStatus,
              reason:
                input.paymentIntent.status === PaymentIntentStatus.INITIATION_PENDING
                  ? input.targetStatus === PaymentIntentStatus.VERIFIED
                    ? 'provider_verified_success_from_pending_local_state'
                    : 'provider_verified_failure_from_pending_local_state'
                  : null,
            }),
          },
          { tx },
        );

        await this.providerWebhookEventRepository.updateProcessing(
          {
            webhookEventId: input.webhookEvent.id,
            paymentIntentId: input.paymentIntent.id,
            providerReference: input.paymentIntent.providerReference,
            processingStatus: WebhookProcessingStatus.VERIFIED,
            processedAt: now,
          },
          { tx },
        );

        return {
          acknowledged: true,
          paymentIntentId: input.paymentIntent.id,
          processingStatus: WebhookProcessingStatus.VERIFIED,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15000,
      },
    );
  }

  private async rejectWebhook(
    webhookEvent: ProviderWebhookEvent,
    paymentIntent: PaymentIntent | null,
    input: {
      failureCode: string;
      failureMessage: string;
      auditEventType?: string;
      auditData?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.transactionRunner.runInTransaction(
      async (tx) => {
        await this.providerWebhookEventRepository.updateProcessing(
          {
            webhookEventId: webhookEvent.id,
            processingStatus: WebhookProcessingStatus.REJECTED,
            paymentIntentId: paymentIntent?.id ?? null,
            providerReference: paymentIntent?.providerReference ?? webhookEvent.providerReference,
            failureCode: input.failureCode,
            failureMessage: input.failureMessage,
            processedAt: new Date(),
          },
          { tx },
        );

        if (paymentIntent && input.auditEventType) {
          await this.paymentIntentAuditLogRepository.append(
            {
              paymentIntentId: paymentIntent.id,
              buyerUserId: paymentIntent.buyerUserId,
              eventType: input.auditEventType,
              data: this.toJsonValue(input.auditData ?? {}),
            },
            { tx },
          );
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10000,
      },
    );
  }

  private async markWebhookProcessed(
    webhookEvent: ProviderWebhookEvent,
    paymentIntent: PaymentIntent | null,
    audit?: {
      eventType: string;
      data: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.transactionRunner.runInTransaction(
      async (tx) => {
        await this.providerWebhookEventRepository.updateProcessing(
          {
            webhookEventId: webhookEvent.id,
            processingStatus: WebhookProcessingStatus.PROCESSED,
            paymentIntentId: paymentIntent?.id ?? null,
            providerReference: paymentIntent?.providerReference ?? webhookEvent.providerReference,
            processedAt: new Date(),
          },
          { tx },
        );

        if (paymentIntent && audit) {
          await this.paymentIntentAuditLogRepository.append(
            {
              paymentIntentId: paymentIntent.id,
              buyerUserId: paymentIntent.buyerUserId,
              eventType: audit.eventType,
              data: this.toJsonValue(audit.data),
            },
            { tx },
          );
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10000,
      },
    );
  }

  private async persistRejectedSignatureEvent(input: {
    provider: PaymentProvider;
    payloadHash: string;
    rawPayload: string;
    rawHeaders: Record<string, string | string[]>;
    failureMessage: string;
  }): Promise<void> {
    try {
      await this.providerWebhookEventRepository.create({
        provider: input.provider,
        providerEventId: `payload:${input.payloadHash}`,
        providerReference: null,
        payloadHash: input.payloadHash,
        signatureValid: false,
        processingStatus: WebhookProcessingStatus.REJECTED,
        failureCode: 'INVALID_SIGNATURE',
        failureMessage: input.failureMessage,
        rawHeaders: this.toJsonValue(input.rawHeaders),
        rawPayload: input.rawPayload,
        verifiedPayload: Prisma.JsonNull,
        paymentIntentId: null,
        processedAt: new Date(),
      });
    } catch (error) {
      if (!this.isDuplicateError(error)) {
        throw error;
      }
    }
  }

  private async createWebhookEvent(
    envelope: ParsedWebhookEnvelope,
    paymentIntent: PaymentIntent | null,
  ): Promise<
    | { created: true; event: ProviderWebhookEvent }
    | { created: false; event: ProviderWebhookEvent }
  > {
    try {
      const event = await this.providerWebhookEventRepository.create({
        provider: envelope.provider,
        providerEventId: envelope.providerEventId,
        providerReference: envelope.providerReference,
        payloadHash: envelope.payloadHash,
        signatureValid: envelope.signatureValid,
        processingStatus: WebhookProcessingStatus.RECEIVED,
        failureCode: null,
        failureMessage: null,
        rawHeaders: this.toJsonValue(envelope.rawHeaders),
        rawPayload: envelope.rawPayload,
        verifiedPayload: envelope.verifiedPayload
          ? this.toJsonValue(envelope.verifiedPayload)
          : Prisma.JsonNull,
        paymentIntentId: paymentIntent?.id ?? null,
      });

      return { created: true, event };
    } catch (error) {
      if (!this.isDuplicateError(error)) {
        throw error;
      }

      const existing =
        (await this.providerWebhookEventRepository.findByProviderAndPayloadHash({
          provider: envelope.provider,
          payloadHash: envelope.payloadHash,
        })) ??
        (await this.providerWebhookEventRepository.findByProviderAndEventId({
          provider: envelope.provider,
          providerEventId: envelope.providerEventId,
        }));

      if (!existing) {
        throw error;
      }

      return { created: false, event: existing };
    }
  }

  private parsePaystackEnvelope(
    parsedBody: unknown,
    payloadHash: string,
    rawPayload: string,
    rawHeaders: Record<string, string | string[]>,
  ): ParsedWebhookEnvelope {
    const body = this.assertRecord(parsedBody);
    const data = this.assertOptionalRecord(body.data);
    const providerEventId =
      data && (typeof data.id === 'string' || typeof data.id === 'number')
        ? String(data.id)
        : `payload:${payloadHash}`;
    const providerReference =
      data && typeof data.reference === 'string' ? data.reference : null;
    const eventType = typeof body.event === 'string' ? body.event : null;

    return {
      provider: PaymentProvider.PAYSTACK,
      payloadHash,
      rawPayload,
      rawHeaders,
      providerEventId,
      providerReference,
      eventType,
      signatureValid: true,
      verifiedPayload: body,
      supported:
        eventType === 'charge.success' || eventType === 'charge.failed',
    };
  }

  private parseMomoEnvelope(
    parsedBody: unknown,
    payloadHash: string,
    rawPayload: string,
    rawHeaders: Record<string, string | string[]>,
  ): ParsedWebhookEnvelope {
    const body = this.assertRecord(parsedBody);
    const providerReference =
      typeof body.referenceId === 'string' ? body.referenceId : null;
    const eventType = typeof body.status === 'string' ? body.status : null;

    return {
      provider: PaymentProvider.MTN_MOMO,
      payloadHash,
      rawPayload,
      rawHeaders,
      providerEventId: `payload:${payloadHash}`,
      providerReference,
      eventType,
      signatureValid: null,
      verifiedPayload: body,
      supported: true,
    };
  }

  private resolveProvider(provider: SupportedPaymentProvider): PaymentProvider {
    return provider === 'paystack'
      ? PaymentProvider.PAYSTACK
      : PaymentProvider.MTN_MOMO;
  }

  private resolveVerificationFailureCode(error: unknown): string {
    if (error instanceof ProviderTimeoutError) {
      return 'PROVIDER_VERIFICATION_TIMEOUT';
    }

    if (error instanceof ProviderResponseError) {
      return error.code;
    }

    if (error instanceof ProviderAuthError) {
      return 'PROVIDER_VERIFICATION_AUTH_ERROR';
    }

    if (error instanceof ProviderNetworkError) {
      return 'PROVIDER_VERIFICATION_NETWORK_ERROR';
    }

    return 'PROVIDER_VERIFICATION_FAILED';
  }

  private isDuplicateError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private assertRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Webhook payload must be a JSON object.');
    }

    return value as Record<string, unknown>;
  }

  private assertOptionalRecord(
    value: unknown,
  ): Record<string, unknown> | null {
    if (!value) {
      return null;
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Webhook payload data must be a JSON object.');
    }

    return value as Record<string, unknown>;
  }

  private toResult(
    _webhookEventId: string,
    paymentIntentId: string | null,
    processingStatus: WebhookProcessingStatus,
  ): PaymentWebhookResult {
    return {
      acknowledged: true,
      paymentIntentId,
      processingStatus,
    };
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return value as Prisma.InputJsonValue;
  }
}