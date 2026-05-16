export class InitiatePaymentResponseDto {
  paymentIntentId!: string;
  eventId!: string;
  organizerId!: string;
  buyerUserId!: string;
  provider!: string;
  status!: string;
  amountMinor!: number;
  currency!: string;
  providerReference!: string;
  providerCheckoutUrl!: string | null;
  providerAccessCode!: string | null;
  failureCode!: string | null;
  failureMessage!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
  initiatedAt!: Date | null;
  verifiedAt!: Date | null;
  failedAt!: Date | null;
  providerVerifiedStatus!: string | null;
  providerVerifiedAmount!: number | null;
  providerVerifiedCurrency!: string | null;
}