import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export type PaystackSignatureValidationResult = {
  valid: boolean;
  failureMessage: string | null;
};

@Injectable()
export class WebhookSignatureService {
  computePayloadHash(rawBody: Buffer): string {
    return createHash('sha256').update(rawBody).digest('hex');
  }

  validatePaystackSignature(
    rawBody: Buffer,
    headers: WebhookHeaders,
    secretKey: string,
  ): PaystackSignatureValidationResult {
    const signature = this.getHeaderValue(headers, 'x-paystack-signature');

    if (!signature) {
      return {
        valid: false,
        failureMessage: 'Missing Paystack webhook signature.',
      };
    }

    const expected = createHmac('sha512', secretKey).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const actualBuffer = Buffer.from(signature, 'utf8');

    if (expectedBuffer.length !== actualBuffer.length) {
      return {
        valid: false,
        failureMessage: 'Invalid Paystack webhook signature.',
      };
    }

    if (!timingSafeEqual(expectedBuffer, actualBuffer)) {
      return {
        valid: false,
        failureMessage: 'Invalid Paystack webhook signature.',
      };
    }

    return {
      valid: true,
      failureMessage: null,
    };
  }

  toJsonHeaders(headers: WebhookHeaders): Record<string, string | string[]> {
    const normalized: Record<string, string | string[]> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        normalized[key] = value;
        continue;
      }

      if (Array.isArray(value)) {
        normalized[key] = [...value];
      }
    }

    return normalized;
  }

  private getHeaderValue(headers: WebhookHeaders, key: string): string | null {
    const header = headers[key];

    if (typeof header === 'string') {
      return header;
    }

    if (Array.isArray(header) && header.length > 0) {
      return header[0] ?? null;
    }

    return null;
  }
}