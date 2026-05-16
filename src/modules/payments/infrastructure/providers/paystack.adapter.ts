import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
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
export class PaystackAdapter implements PaymentProvider {
  readonly provider = PrismaPaymentProvider.PAYSTACK;

  constructor(private readonly configService: AppConfigService) {}

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    return this.initiatePayment(input);
  }

  async initiatePayment(
    input: InitiatePaymentInput,
  ): Promise<InitiatePaymentResult> {
    const providerReference = input.providerReference;

    const body = await this.fetchJson<{
      data: { reference: string; authorization_url?: string; access_code?: string };
    }>(
      `${this.getBaseUrl()}/transaction/initialize`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.configService.getOrThrow('PAYSTACK_SECRET_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: input.customerEmail,
          amount: input.amountMinor,
          currency: input.currency,
          reference: providerReference,
          ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
          metadata: {
            ...input.metadata,
            ...(input.customerPhone ? { customerPhone: input.customerPhone } : {}),
          },
        }),
      },
      'PAYSTACK_INIT_FAILED',
    );

    return {
      providerReference: body.data.reference ?? providerReference,
      checkoutUrl: body.data.authorization_url ?? null,
      accessCode: body.data.access_code ?? null,
      rawResponse: body as Record<string, unknown>,
    };
  }

  async verifyPayment(providerRef: string): Promise<VerifyPaymentResult> {
    const body = await this.fetchJson<{
      data: { reference: string; status: string; amount: number; currency: string };
    }>(
      `${this.getBaseUrl()}/transaction/verify/${encodeURIComponent(providerRef)}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.configService.getOrThrow('PAYSTACK_SECRET_KEY')}`,
        },
      },
      'PAYSTACK_VERIFY_FAILED',
    );

    return {
      providerRef: body.data.reference,
      status: this.mapPaystackStatus(body.data.status),
      amountMinor: BigInt(body.data.amount),
      currency: body.data.currency,
      raw: body as Record<string, unknown>,
    };
  }

  async parseWebhook(input: ParseWebhookInput): Promise<VerifyPaymentResult> {
    this.verifyWebhookSignature(input.rawBody, input.headers);

    const body = input.parsedBody as {
      data: { reference: string; status: string; amount: number; currency: string };
    };

    return {
      providerRef: body.data.reference,
      status: this.mapPaystackStatus(body.data.status),
      amountMinor: BigInt(body.data.amount),
      currency: body.data.currency,
      raw: body as Record<string, unknown>,
    };
  }

  private verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): void {
    const headerValue = headers['x-paystack-signature'];
    const signature =
      typeof headerValue === 'string' ? headerValue : headerValue?.[0];

    if (!signature) {
      throw new WebhookSignatureError('paystack', 'Missing Paystack webhook signature.');
    }

    const expected = createHmac(
      'sha512',
      this.configService.getOrThrow('PAYSTACK_SECRET_KEY'),
    )
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'utf8');
    const actualBuf = Buffer.from(signature, 'utf8');

    if (
      expectedBuf.length !== actualBuf.length ||
      !timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new WebhookSignatureError('paystack', 'Invalid Paystack webhook signature.');
    }
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
          'paystack',
          `Paystack authentication failed with status ${response.status}`,
        );
      }

      if (!response.ok) {
        throw new ProviderResponseError(
          'paystack',
          errorCode,
          response.status,
          `Paystack request failed with status ${response.status}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new ProviderTimeoutError('paystack', 'Paystack request timed out.');
      }
      if (
        error instanceof ProviderResponseError ||
        error instanceof ProviderAuthError
      ) {
        throw error;
      }
      throw new ProviderNetworkError(
        'paystack',
        `Paystack network/request failure: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timeout);
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

  private mapPaystackStatus(
    status: string,
  ): 'SUCCESS' | 'FAILED' | 'PENDING' | 'REVERSED' | 'REFUNDED' {
    switch (status) {
      case 'success':
        return 'SUCCESS';
      case 'failed':
      case 'abandoned':
        return 'FAILED';
      case 'reversed':
        return 'REVERSED';
      case 'refunded':
        return 'REFUNDED';
      default:
        return 'PENDING';
    }
  }
}
