import { Injectable } from '@nestjs/common';
import { PaymentIntent, PaymentIntentStatus, Prisma } from '@prisma/client';
import {
  RepositoryOptions,
  resolveDbClient,
} from '../../../../shared/prisma/prisma.types';
import { PrismaService } from '../../../../shared/prisma/prisma.service';
import {
  PaymentIntentRepository,
  TicketIssuancePaymentIntentRecord,
} from '../../domain/repositories/payment-intent.repository.interface';

@Injectable()
export class PrismaPaymentIntentRepository implements PaymentIntentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByBuyerAndIdempotency(
    params: {
      buyerUserId: string;
      idempotencyUseCase: string;
      idempotencyKeyHash: string;
    },
    options?: RepositoryOptions,
  ): Promise<PaymentIntent | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.paymentIntent.findUnique({
      where: {
        buyerUserId_idempotencyUseCase_idempotencyKeyHash: {
          buyerUserId: params.buyerUserId,
          idempotencyUseCase: params.idempotencyUseCase,
          idempotencyKeyHash: params.idempotencyKeyHash,
        },
      },
    });
  }

  findOwnedByBuyer(
    params: {
      paymentIntentId: string;
      buyerUserId: string;
    },
    options?: RepositoryOptions,
  ): Promise<PaymentIntent | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.paymentIntent.findFirst({
      where: {
        id: params.paymentIntentId,
        buyerUserId: params.buyerUserId,
      },
    });
  }

  findById(
    paymentIntentId: string,
    options?: RepositoryOptions,
  ): Promise<PaymentIntent | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.paymentIntent.findUnique({
      where: { id: paymentIntentId },
    });
  }

  findByIdForTicketIssuance(
    paymentIntentId: string,
    options?: RepositoryOptions,
  ): Promise<TicketIssuancePaymentIntentRecord | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.paymentIntent.findUnique({
      where: { id: paymentIntentId },
      include: {
        buyer: true,
        organizer: true,
        event: {
          include: {
            organizer: true,
          },
        },
      },
    });
  }

  findByProviderReference(
    providerReference: string,
    options?: RepositoryOptions,
  ): Promise<PaymentIntent | null> {
    const db = resolveDbClient(this.prisma, options);

    return db.paymentIntent.findUnique({
      where: { providerReference },
    });
  }

  create(
    data: Prisma.PaymentIntentUncheckedCreateInput,
    options?: RepositoryOptions,
  ): Promise<PaymentIntent> {
    const db = resolveDbClient(this.prisma, options);

    return db.paymentIntent.create({ data });
  }

  markRetryPending(
    paymentIntentId: string,
    options?: RepositoryOptions,
  ): Promise<PaymentIntent> {
    const db = resolveDbClient(this.prisma, options);

    return db.paymentIntent.update({
      where: { id: paymentIntentId },
      data: {
        status: PaymentIntentStatus.INITIATION_PENDING,
        providerCheckoutUrl: null,
        providerAccessCode: null,
        providerRawResponse: Prisma.JsonNull,
        failureCode: null,
        failureMessage: null,
        failedAt: null,
      },
    });
  }

  markInitiated(
    input: {
      paymentIntentId: string;
      providerCheckoutUrl?: string | null;
      providerAccessCode?: string | null;
      providerRawResponse: Prisma.InputJsonValue;
      initiatedAt: Date;
      status?: PaymentIntentStatus;
    },
    options?: RepositoryOptions,
  ): Promise<PaymentIntent> {
    const db = resolveDbClient(this.prisma, options);

    return db.paymentIntent.update({
      where: { id: input.paymentIntentId },
      data: {
        status: input.status ?? PaymentIntentStatus.INITIATED,
        providerCheckoutUrl: input.providerCheckoutUrl ?? null,
        providerAccessCode: input.providerAccessCode ?? null,
        providerRawResponse: input.providerRawResponse,
        initiatedAt: input.initiatedAt,
        verifiedAt: null,
        failureCode: null,
        failureMessage: null,
        failedAt: null,
        providerVerifiedStatus: null,
        providerVerifiedAmount: null,
        providerVerifiedCurrency: null,
        providerVerificationRaw: Prisma.JsonNull,
      },
    });
  }

  markFailed(
    input: {
      paymentIntentId: string;
      failureCode: string;
      failureMessage: string;
      providerRawResponse?: Prisma.InputJsonValue | null;
      failedAt: Date;
    },
    options?: RepositoryOptions,
  ): Promise<PaymentIntent> {
    const db = resolveDbClient(this.prisma, options);

    return db.paymentIntent.update({
      where: { id: input.paymentIntentId },
      data: {
        status: PaymentIntentStatus.INITIATION_FAILED,
        providerRawResponse: input.providerRawResponse ?? Prisma.JsonNull,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        failedAt: input.failedAt,
      },
    });
  }

  async transitionToVerified(
    input: {
      paymentIntentId: string;
      verifiedAt: Date;
      providerVerifiedStatus: string;
      providerVerifiedAmount: number | null;
      providerVerifiedCurrency: string | null;
      providerVerificationRaw: Prisma.InputJsonValue;
    },
    options?: RepositoryOptions,
  ): Promise<number> {
    const db = resolveDbClient(this.prisma, options);
    const result = await db.paymentIntent.updateMany({
      where: {
        id: input.paymentIntentId,
        status: {
          in: [
            PaymentIntentStatus.INITIATED,
            PaymentIntentStatus.INITIATION_PENDING,
          ],
        },
      },
      data: {
        status: PaymentIntentStatus.VERIFIED,
        verifiedAt: input.verifiedAt,
        failedAt: null,
        failureCode: null,
        failureMessage: null,
        providerVerifiedStatus: input.providerVerifiedStatus,
        providerVerifiedAmount: input.providerVerifiedAmount,
        providerVerifiedCurrency: input.providerVerifiedCurrency,
        providerVerificationRaw: input.providerVerificationRaw,
      },
    });

    return result.count;
  }

  async transitionToFailed(
    input: {
      paymentIntentId: string;
      failedAt: Date;
      failureCode: string;
      failureMessage: string;
      providerVerifiedStatus: string;
      providerVerifiedAmount: number | null;
      providerVerifiedCurrency: string | null;
      providerVerificationRaw: Prisma.InputJsonValue;
    },
    options?: RepositoryOptions,
  ): Promise<number> {
    const db = resolveDbClient(this.prisma, options);
    const result = await db.paymentIntent.updateMany({
      where: {
        id: input.paymentIntentId,
        status: {
          in: [
            PaymentIntentStatus.INITIATED,
            PaymentIntentStatus.INITIATION_PENDING,
          ],
        },
      },
      data: {
        status: PaymentIntentStatus.FAILED,
        failedAt: input.failedAt,
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        providerVerifiedStatus: input.providerVerifiedStatus,
        providerVerifiedAmount: input.providerVerifiedAmount,
        providerVerifiedCurrency: input.providerVerifiedCurrency,
        providerVerificationRaw: input.providerVerificationRaw,
      },
    });

    return result.count;
  }
}