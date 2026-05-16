import {
  PaymentProvider,
  Prisma,
  ProviderWebhookEvent,
  WebhookProcessingStatus,
} from '@prisma/client';
import { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export abstract class ProviderWebhookEventRepository {
  abstract create(
    data: Prisma.ProviderWebhookEventUncheckedCreateInput,
    options?: RepositoryOptions,
  ): Promise<ProviderWebhookEvent>;

  abstract findByProviderAndEventId(
    params: {
      provider: PaymentProvider;
      providerEventId: string;
    },
    options?: RepositoryOptions,
  ): Promise<ProviderWebhookEvent | null>;

  abstract findByProviderAndPayloadHash(
    params: {
      provider: PaymentProvider;
      payloadHash: string;
    },
    options?: RepositoryOptions,
  ): Promise<ProviderWebhookEvent | null>;

  abstract updateProcessing(
    input: {
      webhookEventId: string;
      processingStatus: WebhookProcessingStatus;
      paymentIntentId?: string | null;
      providerReference?: string | null;
      signatureValid?: boolean | null;
      verifiedPayload?: Prisma.InputJsonValue | null;
      failureCode?: string | null;
      failureMessage?: string | null;
      processedAt?: Date | null;
    },
    options?: RepositoryOptions,
  ): Promise<ProviderWebhookEvent>;
}