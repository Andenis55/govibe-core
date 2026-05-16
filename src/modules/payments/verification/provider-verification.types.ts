import { PaymentProvider } from '@prisma/client';

export type ProviderVerificationStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'PENDING'
  | 'UNKNOWN';

export type ProviderVerificationResult = {
  provider: PaymentProvider;
  providerReference: string;
  status: ProviderVerificationStatus;
  amountMinor: number | null;
  currency: string | null;
  providerStatus: string;
  paidAt: Date | null;
  rawResponse: Record<string, unknown>;
};

export interface PaymentVerificationAdapter {
  readonly provider: PaymentProvider;
  verifyByReference(providerReference: string): Promise<ProviderVerificationResult>;
}