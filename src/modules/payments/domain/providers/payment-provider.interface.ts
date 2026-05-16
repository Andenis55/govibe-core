import { PaymentProvider as PrismaPaymentProvider } from '@prisma/client';

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export type ParseWebhookInput = {
  rawBody: Buffer;
  parsedBody: unknown;
  headers: WebhookHeaders;
};

export type InitiatePaymentInput = {
  paymentIntentId: string;
  providerReference: string;
  amountMinor: number;
  currency: string;
  customerEmail: string;
  customerPhone?: string | null;
  callbackUrl?: string | null;
  metadata: {
    paymentIntentId: string;
    eventId: string;
    organizerId: string;
    buyerUserId: string;
  };
};

export type InitiatePaymentResult = {
  providerReference: string;
  checkoutUrl?: string | null;
  accessCode?: string | null;
  rawResponse: Record<string, unknown>;
};

export type VerifyPaymentResult = {
  providerRef: string;
  status: 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'REFUNDED';
  amountMinor: bigint;
  currency: string;
  raw: Record<string, unknown>;
};

export interface PaymentProvider {
  readonly provider: PrismaPaymentProvider;
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  initiatePayment(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  verifyPayment(providerRef: string): Promise<VerifyPaymentResult>;
  parseWebhook(input: ParseWebhookInput): Promise<VerifyPaymentResult>;
}
