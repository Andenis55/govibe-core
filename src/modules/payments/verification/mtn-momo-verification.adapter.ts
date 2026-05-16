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
export class MtnMomoVerificationAdapter implements PaymentVerificationAdapter {
  readonly provider = PaymentProvider.MTN_MOMO;

  constructor(private readonly configService: AppConfigService) {}

  async verifyByReference(
    providerReference: string,
  ): Promise<ProviderVerificationResult> {
    try {
      const token = await this.getAccessToken();
      const response = await fetchWithTimeout(
        `${this.getBaseUrl()}/collection/v1_0/requesttopay/${encodeURIComponent(providerReference)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Target-Environment': this.getTargetEnvironment(),
            'Ocp-Apim-Subscription-Key': this.getSubscriptionKey(),
          },
        },
        this.getTimeoutMs(),
      );

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(
          'momo',
          `MoMo authentication failed with status ${response.status}`,
        );
      }

      if (!response.ok) {
        throw new ProviderResponseError(
          'momo',
          'MOMO_VERIFY_FAILED',
          response.status,
          `MoMo verification failed with status ${response.status}`,
        );
      }

      const body = (await response.json()) as {
        amount?: string;
        currency?: string;
        status?: string;
        financialTransactionId?: string;
      };
      const parsedAmount =
        typeof body.amount === 'string' && body.amount.trim().length > 0
          ? Number(body.amount)
          : NaN;

      return {
        provider: this.provider,
        providerReference,
        status: this.mapStatus(body.status),
        amountMinor: Number.isFinite(parsedAmount) ? parsedAmount : null,
        currency: typeof body.currency === 'string' ? body.currency : null,
        providerStatus: String(body.status ?? 'UNKNOWN'),
        paidAt: null,
        rawResponse: body as Record<string, unknown>,
      };
    } catch (error) {
      if (error instanceof FetchTimeoutError) {
        throw new ProviderTimeoutError('momo', 'MoMo verification timed out.');
      }

      if (
        error instanceof ProviderAuthError ||
        error instanceof ProviderResponseError ||
        error instanceof ProviderTimeoutError
      ) {
        throw error;
      }

      throw new ProviderNetworkError(
        'momo',
        `MoMo verification request failed: ${(error as Error).message}`,
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    const response = await fetchWithTimeout(
      `${this.getBaseUrl()}/collection/token/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.buildBasicAuth()}`,
          'Ocp-Apim-Subscription-Key': this.getSubscriptionKey(),
        },
      },
      this.getTimeoutMs(),
    );

    if (response.status === 401 || response.status === 403) {
      throw new ProviderAuthError(
        'momo',
        `MoMo authentication failed with status ${response.status}`,
      );
    }

    if (!response.ok) {
      throw new ProviderResponseError(
        'momo',
        'MOMO_TOKEN_FAILED',
        response.status,
        `MoMo token request failed with status ${response.status}`,
      );
    }

    const body = (await response.json()) as { access_token?: string };

    if (!body.access_token) {
      throw new ProviderResponseError(
        'momo',
        'MOMO_TOKEN_FAILED',
        502,
        'MoMo token response did not include an access token.',
      );
    }

    return body.access_token;
  }

  private buildBasicAuth(): string {
    const apiUser = String(
      this.configService.getOptional('MTN_MOMO_API_USER') ??
        this.configService.getOrThrow('MTN_MOMO_API_KEY'),
    );
    const apiKey = String(
      this.configService.getOptional('MTN_MOMO_API_SECRET') ??
        this.configService.getOrThrow('MTN_MOMO_API_KEY'),
    );

    return Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
  }

  private getBaseUrl(): string {
    const configuredBaseUrl = this.configService.getOptional('MTN_MOMO_BASE_URL');

    if (configuredBaseUrl) {
      return configuredBaseUrl;
    }

    return this.getTargetEnvironment() === 'sandbox'
      ? 'https://sandbox.momodeveloper.mtn.com'
      : 'https://momodeveloper.mtn.com';
  }

  private getSubscriptionKey(): string {
    return String(
      this.configService.getOptional('MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY') ??
        this.configService.getOrThrow('MTN_MOMO_SUBSCRIPTION_KEY'),
    );
  }

  private getTargetEnvironment(): string {
    return String(
      this.configService.getOptional('MTN_MOMO_TARGET_ENVIRONMENT') ??
        this.configService.getOrThrow('MTN_MOMO_ENVIRONMENT'),
    );
  }

  private getTimeoutMs(): number {
    return this.configService.getOptional('PAYMENT_PROVIDER_TIMEOUT_MS') ?? 10000;
  }

  private mapStatus(status: string | undefined): ProviderVerificationStatus {
    switch (status) {
      case 'SUCCESSFUL':
        return 'SUCCESS';
      case 'FAILED':
      case 'EXPIRED':
      case 'REJECTED':
      case 'TIMEOUT':
        return 'FAILED';
      case 'PENDING':
        return 'PENDING';
      default:
        return 'UNKNOWN';
    }
  }
}