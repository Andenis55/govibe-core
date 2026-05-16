import { randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PaymentProvider as PrismaPaymentProvider } from '@prisma/client';
import { AppConfigService } from '../../../../shared/config/config.service';
import {
  InitiatePaymentInput,
  InitiatePaymentResult,
  ParseWebhookInput,
  PaymentProvider,
  VerifyPaymentResult,
} from '../../domain/providers/payment-provider.interface';
import {
  ProviderAuthError,
  ProviderNetworkError,
  ProviderResponseError,
  ProviderTimeoutError,
  WebhookSignatureError,
} from '../../domain/providers/provider-errors';

@Injectable()
export class MomoAdapter implements PaymentProvider {
  readonly provider = PrismaPaymentProvider.MTN_MOMO;

  constructor(private readonly configService: AppConfigService) {}

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    return this.initiatePayment(input);
  }

  async initiatePayment(
    input: InitiatePaymentInput,
  ): Promise<InitiatePaymentResult> {
    if (!input.customerPhone) {
      throw new ProviderResponseError(
        'momo',
        'MOMO_INVALID_INITIATE_INPUT',
        0,
        'MoMo initiation requires customerPhone.',
      );
    }

    const providerReference = input.providerReference ?? randomUUID();
    const baseUrl = this.getBaseUrl();
    const token = await this.getAccessToken();

    await this.fetchVoid(
      `${baseUrl}/collection/v1_0/requesttopay`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Reference-Id': providerReference,
          'X-Target-Environment': this.getTargetEnvironment(),
          'Ocp-Apim-Subscription-Key': this.getSubscriptionKey(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: input.amountMinor.toString(),
          currency: input.currency,
          externalId: input.paymentIntentId,
          payer: {
            partyIdType: 'MSISDN',
            partyId: input.customerPhone,
          },
          payerMessage: `GoVibe payment ${input.paymentIntentId}`,
          payeeNote: 'GoVibe ticket payment',
        }),
      },
      'MOMO_INIT_FAILED',
      [202],
    );

    return {
      providerReference,
      checkoutUrl: null,
      accessCode: null,
      rawResponse: { status: 202 },
    };
  }

  async verifyPayment(providerRef: string): Promise<VerifyPaymentResult> {
    const baseUrl = this.getBaseUrl();
    const token = await this.getAccessToken();

    const body = await this.fetchJson<{
      amount: string;
      currency: string;
      status: string;
    }>(
      `${baseUrl}/collection/v1_0/requesttopay/${providerRef}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Target-Environment': this.getTargetEnvironment(),
          'Ocp-Apim-Subscription-Key': this.getSubscriptionKey(),
        },
      },
      'MOMO_VERIFY_FAILED',
    );

    return {
      providerRef,
      status: this.mapMomoStatus(body.status),
      amountMinor: BigInt(body.amount),
      currency: body.currency,
      raw: body as Record<string, unknown>,
    };
  }

  async parseWebhook(input: ParseWebhookInput): Promise<VerifyPaymentResult> {
    this.verifyWebhookAuthenticity(input.rawBody, input.headers);

    const body = input.parsedBody as {
      referenceId?: string;
      status: string;
      amount: string;
      currency: string;
    };

    if (!body.referenceId) {
      throw new WebhookSignatureError('momo', 'MoMo webhook missing referenceId.');
    }

    return {
      providerRef: body.referenceId,
      status: this.mapMomoStatus(body.status),
      amountMinor: BigInt(body.amount),
      currency: body.currency,
      raw: body as Record<string, unknown>,
    };
  }

  private verifyWebhookAuthenticity(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const rawSecret = this.configService.get('MTN_MOMO_WEBHOOK_SECRET');
    if (!rawSecret) {
      throw new WebhookSignatureError('momo', 'MoMo webhook secret not configured.');
    }
    const configuredSecret = String(rawSecret);

    const headerValue = headers['x-momo-signature'];
    const signature =
      typeof headerValue === 'string' ? headerValue : headerValue?.[0];

    if (!signature) {
      throw new WebhookSignatureError('momo', 'Missing MoMo webhook signature.');
    }

    const expected = createHmac('sha256', configuredSecret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signature, 'utf8');

    if (
      expectedBuf.length !== actualBuf.length ||
      !timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new WebhookSignatureError('momo', 'Invalid MoMo webhook signature.');
    }
  }

  private async getAccessToken(): Promise<string> {
    const body = await this.fetchJson<{ access_token: string }>(
      `${this.getBaseUrl()}/collection/token/`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${this.buildBasicAuth()}`,
          'Ocp-Apim-Subscription-Key': this.getSubscriptionKey(),
        },
      },
      'MOMO_TOKEN_FAILED',
    );

    return body.access_token;
  }

  private async fetchJson<T>(
    url: string,
    init: RequestInit,
    errorCode: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.getTimeoutMs());

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(
          'momo',
          `MoMo authentication failed with status ${response.status}`,
        );
      }

      if (!response.ok) {
        throw new ProviderResponseError(
          'momo',
          errorCode,
          response.status,
          `MoMo request failed with status ${response.status}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new ProviderTimeoutError('momo', 'MoMo request timed out.');
      }
      if (
        error instanceof ProviderResponseError ||
        error instanceof ProviderAuthError
      ) {
        throw error;
      }
      throw new ProviderNetworkError(
        'momo',
        `MoMo network/request failure: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchVoid(
    url: string,
    init: RequestInit,
    errorCode: string,
    acceptedStatusCodes: number[],
  ): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.getTimeoutMs());

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      if (response.status === 401 || response.status === 403) {
        throw new ProviderAuthError(
          'momo',
          `MoMo authentication failed with status ${response.status}`,
        );
      }

      if (!acceptedStatusCodes.includes(response.status)) {
        throw new ProviderResponseError(
          'momo',
          errorCode,
          response.status,
          `MoMo request failed with status ${response.status}`,
        );
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new ProviderTimeoutError('momo', 'MoMo request timed out.');
      }
      if (
        error instanceof ProviderResponseError ||
        error instanceof ProviderAuthError
      ) {
        throw error;
      }
      throw new ProviderNetworkError(
        'momo',
        `MoMo network/request failure: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildBasicAuth(): string {
    const apiUser =
      this.configService.getOptional('MTN_MOMO_API_USER') ??
      this.configService.getOrThrow('MTN_MOMO_API_KEY');
    const apiKey = this.configService.getOrThrow('MTN_MOMO_API_SECRET');
    return Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
  }

  private getBaseUrl(): string {
    const configuredBaseUrl = this.configService.getOptional('MTN_MOMO_BASE_URL');

    if (configuredBaseUrl) {
      return configuredBaseUrl;
    }

    const env = this.getTargetEnvironment();
    return env === 'sandbox'
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

  private mapMomoStatus(
    status: string,
  ): 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'REFUNDED' {
    switch (status) {
      case 'SUCCESSFUL':
        return 'SUCCESS';
      case 'FAILED':
      case 'REJECTED':
        return 'FAILED';
      case 'REVERSED':
        return 'REVERSED';
      default:
        return 'PENDING';
    }
  }
}
