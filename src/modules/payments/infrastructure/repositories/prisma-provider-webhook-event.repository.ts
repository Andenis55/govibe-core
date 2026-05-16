import {
  Injectable,
} from '@nestjs/common';
import {
  PaymentProvider,
  Prisma,
  ProviderWebhookEvent,
  WebhookProcessingStatus,
} from '@prisma/client';
import {
  RepositoryOptions,
  resolveDbClient,
} from '../../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import { ProviderWebhookEventRepository } from '../../domain/repositories/provider-webhook-event.repository.interface';

@Injectable()
export class PrismaProviderWebhookEventRepository
  implements ProviderWebhookEventRepository
{
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Prisma.ProviderWebhookEventUncheckedCreateInput,
    options?: RepositoryOptions,
  ): Promise<ProviderWebhookEvent> {
    const db = resolveDbClient(this.prisma, options);

    return db.providerWebhookEvent.create({ data });
  }

  findByProviderAndEventId(
    params: {
      provider: PaymentProvider;
      providerEventId: string;
    },
    options?: RepositoryOptions,
  ): Promise<ProviderWebhookEvent | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.providerWebhookEvent.findUnique({
      where: {
        provider_providerEventId: {
          provider: params.provider,
          providerEventId: params.providerEventId,
        },
      },
    });
  }

  findByProviderAndPayloadHash(
    params: {
      provider: PaymentProvider;
      payloadHash: string;
    },
    options?: RepositoryOptions,
  ): Promise<ProviderWebhookEvent | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.providerWebhookEvent.findUnique({
      where: {
        provider_payloadHash: {
          provider: params.provider,
          payloadHash: params.payloadHash,
        },
      },
    });
  }

  updateProcessing(
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
  ): Promise<ProviderWebhookEvent> {
    const db = resolveDbClient(this.prisma, options);

    return db.providerWebhookEvent.update({
      where: { id: input.webhookEventId },
      data: {
        processingStatus: input.processingStatus,
        paymentIntentId:
          input.paymentIntentId === undefined ? undefined : input.paymentIntentId,
        providerReference:
          input.providerReference === undefined ? undefined : input.providerReference,
        signatureValid:
          input.signatureValid === undefined ? undefined : input.signatureValid,
        verifiedPayload:
          input.verifiedPayload === undefined
            ? undefined
            : input.verifiedPayload ?? Prisma.JsonNull,
        failureCode:
          input.failureCode === undefined ? undefined : input.failureCode,
        failureMessage:
          input.failureMessage === undefined ? undefined : input.failureMessage,
        processedAt: input.processedAt === undefined ? undefined : input.processedAt,
      },
    });
  }
}