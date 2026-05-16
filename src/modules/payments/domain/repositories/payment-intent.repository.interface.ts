import { PaymentIntent, PaymentIntentStatus, Prisma } from '@prisma/client';
import { RepositoryOptions } from '../../../../shared/prisma/prisma.types';

export type TicketIssuancePaymentIntentRecord = Prisma.PaymentIntentGetPayload<{
  include: {
    buyer: true;
    organizer: true;
    event: {
      include: {
        organizer: true;
      };
    };
  };
}>;

export abstract class PaymentIntentRepository {
  abstract findByBuyerAndIdempotency(
    params: {
      buyerUserId: string;
      idempotencyUseCase: string;
      idempotencyKeyHash: string;
    },
    options?: RepositoryOptions,
  ): Promise<PaymentIntent | null>;

  abstract findOwnedByBuyer(
    params: {
      paymentIntentId: string;
      buyerUserId: string;
    },
    options?: RepositoryOptions,
  ): Promise<PaymentIntent | null>;

  abstract findById(
    paymentIntentId: string,
    options?: RepositoryOptions,
  ): Promise<PaymentIntent | null>;

  abstract findByIdForTicketIssuance(
    paymentIntentId: string,
    options?: RepositoryOptions,
  ): Promise<TicketIssuancePaymentIntentRecord | null>;

  abstract findByProviderReference(
    providerReference: string,
    options?: RepositoryOptions,
  ): Promise<PaymentIntent | null>;

  abstract create(
    data: Prisma.PaymentIntentUncheckedCreateInput,
    options?: RepositoryOptions,
  ): Promise<PaymentIntent>;

  abstract markRetryPending(
    paymentIntentId: string,
    options?: RepositoryOptions,
  ): Promise<PaymentIntent>;

  abstract markInitiated(
    input: {
      paymentIntentId: string;
      providerCheckoutUrl?: string | null;
      providerAccessCode?: string | null;
      providerRawResponse: Prisma.InputJsonValue;
      initiatedAt: Date;
      status?: PaymentIntentStatus;
    },
    options?: RepositoryOptions,
  ): Promise<PaymentIntent>;

  abstract markFailed(
    input: {
      paymentIntentId: string;
      failureCode: string;
      failureMessage: string;
      providerRawResponse?: Prisma.InputJsonValue | null;
      failedAt: Date;
    },
    options?: RepositoryOptions,
  ): Promise<PaymentIntent>;

  abstract transitionToVerified(
    input: {
      paymentIntentId: string;
      verifiedAt: Date;
      providerVerifiedStatus: string;
      providerVerifiedAmount: number | null;
      providerVerifiedCurrency: string | null;
      providerVerificationRaw: Prisma.InputJsonValue;
    },
    options?: RepositoryOptions,
  ): Promise<number>;

  abstract transitionToFailed(
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
  ): Promise<number>;
}