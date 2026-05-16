import { PaymentIntentStatus, PaymentProvider } from '@prisma/client';

export class AdminPaymentResponseDto {
  id!: string;
  buyerUserId!: string;
  organizerId!: string;
  eventId!: string;
  provider!: PaymentProvider;
  status!: PaymentIntentStatus;
  amountMinor!: number;
  currency!: string;
  providerReference!: string;
  providerVerifiedStatus!: string | null;
  providerVerifiedAmount!: number | null;
  providerVerifiedCurrency!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  verifiedAt!: Date | null;
  failedAt!: Date | null;
}
