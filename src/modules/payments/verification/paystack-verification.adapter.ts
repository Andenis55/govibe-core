import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { AppConfigService } from '../../../shared/config/config.service';
import {
  ProviderAuthError,
  ProviderNetworkError,
  ProviderResponseError,
  ProviderTimeoutError,
} from '../domain/providers/provider-errors';
import { fetchWithTimeout, FetchTimeoutError } from '../utils/fetch-with-timeout.util';
import {
  PaymentVerificationAdapter,
  ProviderVerificationResult,
  ProviderVerificationStatus,
} from './provider-verification.types';

@Injectable()
export class PaystackVerificationAdapter implements PaymentVerificationAdapter {
  readonly provider = PaymentProvider.PAYSTACK;

  constructor(private readonly configService: AppConfigService) {}

  async verifyByReference(
    providerReference: string,
  ): Promise<ProviderVerificationResult> {
    try {
      const response = await fetchWithTimeout(
        `${this.getBaseUrl()}/transaction/verify/${encodeURIComponent(providerReference)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${this.configService.getOrThrow('PAYSTACK_SECRET_KEY')}`,
          },
        },
        this.getTimeoutMs(),
      );

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(
          'paystack',
          `Paystack authentication failed with status ${response.status}`,
        );
      }

      if (!response.ok) {
        throw new ProviderResponseError(
          'paystack',
          'PAYSTACK_VERIFY_FAILED',
          response.status,
          `Paystack verification failed with status ${response.status}`,
        );
      }

      const body = (await response.json()) as {
        data?: {
          reference?: string;
          status?: string;
          amount?: number;
          currency?: string;
          paid_at?: string;
        };
      };

      return {
        provider: this.provider,
        providerReference: String(body.data?.reference ?? providerReference),
        status: this.mapStatus(body.data?.status),
        amountMinor:
          typeof body.data?.amount === 'number' ? body.data.amount : null,
        currency:
          typeof body.data?.currency === 'string' ? body.data.currency : null,
        providerStatus: String(body.data?.status ?? 'unknown'),
        paidAt: body.data?.paid_at ? new Date(body.data.paid_at) : null,
        rawResponse: body as Record<string, unknown>,
      };
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        throw new ProviderTimeoutError('paystack', 'Paystack verification timed out.');
      }

      if (
        error instanceof ProviderAuthError ||
        error instanceof ProviderResponseError ||
        error instanceof ProviderTimeoutError
      ) {
        throw error;
      }

      throw new ProviderNetworkError(
        'paystack',
        `Paystack verification request failed: ${(error as Error).message}`,
      );
    }
  }

  private getBaseUrl(): string {
    return String(
      this.configService.getOptional('PAYSTACK_BASE_URL') ??
        'https://api.paystack.co',
    );
  }

  private getTimeoutMs(): number {
    return this.configService.getOptional('PAYMENT_PROVIDER_TIMEOUT_MS') ?? 10000;
  }

  private mapStatus(status: string | undefined): ProviderVerificationStatus {
    switch (status) {
      case 'success':
        return 'SUCCESS';
      case 'failed':
      case 'abandoned':
      case 'reversed':
      case 'refunded':
        return 'FAILED';
      case 'pending':
      case 'ongoing':
        return 'PENDING';
      default:
        return 'UNKNOWN';
    }
  }
}