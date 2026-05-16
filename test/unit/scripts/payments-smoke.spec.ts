import {
  assertNonPlaceholderCredentials,
  assertRequiredEnvSet,
  assertSafeLiveUsage,
  resolveSmokeProviders,
} from '../../../scripts/payments-smoke';

describe('payments smoke provider scoping', () => {
  it('defaults to both providers when no smoke or pilot provider scope is set', () => {
    expect(resolveSmokeProviders({})).toEqual(['paystack', 'momo']);
  });

  it('uses PAYMENT_SMOKE_PROVIDERS when explicitly set', () => {
    expect(
      resolveSmokeProviders({
        PAYMENT_SMOKE_PROVIDERS: 'paystack',
        PILOT_ALLOWED_PAYMENT_PROVIDERS: 'momo',
      }),
    ).toEqual(['paystack']);
  });

  it('falls back to PILOT_ALLOWED_PAYMENT_PROVIDERS when no explicit smoke scope is set', () => {
    expect(
      resolveSmokeProviders({
        PILOT_ALLOWED_PAYMENT_PROVIDERS: 'paystack',
      }),
    ).toEqual(['paystack']);
  });

  it('rejects unsupported provider values', () => {
    expect(() =>
      resolveSmokeProviders({
        PAYMENT_SMOKE_PROVIDERS: 'paystack,stripe',
      }),
    ).toThrow('Unsupported payment smoke provider(s): stripe.');
  });

  it('requires only the selected provider env keys', () => {
    expect(() =>
      assertRequiredEnvSet(['paystack'], {
        PAYSTACK_SECRET_KEY: 'sk_test_valid_provider_key_12345',
        PAYMENT_SMOKE_PAYSTACK_EMAIL: 'buyer@example.com',
      }),
    ).not.toThrow();

    expect(() =>
      assertRequiredEnvSet(['momo'], {
        MTN_MOMO_API_KEY: 'valid-momo-api-key-12345',
        MTN_MOMO_API_SECRET: 'valid-momo-api-secret-12345',
        MTN_MOMO_SUBSCRIPTION_KEY: 'valid-momo-sub-key-12345',
        MTN_MOMO_ENVIRONMENT: 'sandbox',
      }),
    ).toThrow('Missing required environment variables: PAYMENT_SMOKE_MOMO_PHONE, PAYMENT_SMOKE_MOMO_CURRENCY');
  });

  it('checks placeholder credentials only for the selected providers', () => {
    expect(() =>
      assertNonPlaceholderCredentials(['paystack'], {
        PAYSTACK_SECRET_KEY: 'sk_test_real_key_123456789',
        MTN_MOMO_API_KEY: 'replace-with-momo-api-key',
        MTN_MOMO_API_SECRET: 'replace-with-momo-api-secret',
        MTN_MOMO_SUBSCRIPTION_KEY: 'replace-with-momo-subscription-key',
      }),
    ).not.toThrow();

    expect(() =>
      assertNonPlaceholderCredentials(['momo'], {
        MTN_MOMO_API_KEY: 'replace-with-momo-api-key',
        MTN_MOMO_API_SECRET: 'replace-with-momo-api-secret',
        MTN_MOMO_SUBSCRIPTION_KEY: 'replace-with-momo-subscription-key',
      }),
    ).toThrow(
      'Replace placeholder provider credentials before running smoke validation: MTN_MOMO_API_KEY, MTN_MOMO_API_SECRET, MTN_MOMO_SUBSCRIPTION_KEY',
    );
  });

  it('applies live-usage checks only to the selected providers', () => {
    expect(() =>
      assertSafeLiveUsage(['paystack'], {
        PAYSTACK_SECRET_KEY: 'sk_test_safe_key_123456789',
        MTN_MOMO_ENVIRONMENT: 'production',
      }),
    ).not.toThrow();

    expect(() =>
      assertSafeLiveUsage(['momo'], {
        PAYSTACK_SECRET_KEY: 'sk_live_paystack_key',
        MTN_MOMO_ENVIRONMENT: 'sandbox',
      }),
    ).not.toThrow();

    expect(() =>
      assertSafeLiveUsage(['paystack'], {
        PAYSTACK_SECRET_KEY: 'sk_live_paystack_key',
      }),
    ).toThrow(
      'Refusing to run Paystack smoke against a live secret key without PAYMENT_SMOKE_ALLOW_LIVE=true.',
    );
  });
});