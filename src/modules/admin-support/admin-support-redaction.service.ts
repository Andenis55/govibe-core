import { Injectable } from '@nestjs/common';

const FORBIDDEN_EXACT_KEYS = [
  'password',
  'passwordHash',
  'accessToken',
  'refreshToken',
  'refreshTokenHash',
  'previousRefreshTokenHash',
  'sessionTokenHash',
  'admissionToken',
  'admissionTokenHash',
  'tokenHash',
  'scanNonceHash',
  'providerRawResponse',
  'providerVerificationRaw',
  'providerAccessCode',
  'providerCheckoutUrl',
  'authorizationUrl',
  'rawPayload',
  'rawHeaders',
  'verifiedPayload',
  'apiKey',
  'authorization',
  'cookie',
  'set-cookie',
  'x-paystack-signature',
  'x-reference-id',
  'DATABASE_URL',
  'REDIS_URL',
  'PAYSTACK_SECRET_KEY',
  'MTN_MOMO_API_KEY',
  'MTN_MOMO_API_SECRET',
  'MTN_MOMO_SUBSCRIPTION_KEY',
  'JWT_SECRET',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const;

const HIGH_RISK_KEY_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'apikey',
  'authorization',
  'cookie',
] as const;

const EXACT_FORBIDDEN_KEY_SET = new Set(
  FORBIDDEN_EXACT_KEYS.map((key) => normalizeKey(key)),
);

@Injectable()
export class AdminSupportRedactionService {
  private readonly sensitiveValueFragments = Array.from(
    new Set(
      [
        process.env.DATABASE_URL,
        process.env.REDIS_URL,
        process.env.PAYSTACK_SECRET_KEY,
        process.env.MTN_MOMO_API_KEY,
        process.env.MTN_MOMO_API_SECRET,
        process.env.MTN_MOMO_SUBSCRIPTION_KEY,
        process.env.JWT_SECRET,
        process.env.JWT_ACCESS_SECRET,
        process.env.JWT_REFRESH_SECRET,
      ]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  );

  redactResponse<T>(value: T): T {
    return this.redactUnknown(value) as T;
  }

  private redactUnknown(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.redactUnknown(entry));
    }

    if (value instanceof Date || value === null) {
      return value;
    }

    if (typeof value === 'string') {
      return this.shouldRedactStringValue(value) ? '[REDACTED]' : value;
    }

    if (typeof value !== 'object') {
      return value;
    }

    const output: Record<string, unknown> = {};

    for (const [key, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (this.shouldRedactKey(key)) {
        continue;
      }

      const redactedChild = this.redactUnknown(childValue);

      if (redactedChild !== undefined) {
        output[key] = redactedChild;
      }
    }

    return output;
  }

  private shouldRedactKey(key: string): boolean {
    const normalizedKey = normalizeKey(key);

    if (EXACT_FORBIDDEN_KEY_SET.has(normalizedKey)) {
      return true;
    }

    return HIGH_RISK_KEY_FRAGMENTS.some((fragment) =>
      normalizedKey.includes(fragment),
    );
  }

  private shouldRedactStringValue(value: string): boolean {
    const trimmed = value.trim();

    if (!trimmed) {
      return false;
    }

    const lower = trimmed.toLowerCase();

    if (
      lower.includes('postgres://') ||
      lower.includes('postgresql://') ||
      lower.includes('redis://') ||
      lower.includes('bearer ')
    ) {
      return true;
    }

    if (
      HIGH_RISK_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment))
    ) {
      return true;
    }

    return this.sensitiveValueFragments.some((fragment) =>
      lower.includes(fragment),
    );
  }
}

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}
