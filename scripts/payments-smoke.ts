import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { AppConfigService } from '../src/shared/config/config.service';
import { MomoAdapter } from '../src/modules/payments/infrastructure/providers/momo.adapter';
import { PaystackAdapter } from '../src/modules/payments/infrastructure/providers/paystack.adapter';
import {
  SUPPORTED_PAYMENT_PROVIDERS,
  type SupportedPaymentProvider,
} from '../src/shared/constants/payment.constants';

type EnvMap = NodeJS.ProcessEnv;

type SmokeResult = {
  provider: SupportedPaymentProvider;
  initiated: Record<string, unknown>;
  verified?: Record<string, unknown>;
};

const PROVIDER_ENV_REQUIREMENTS: Record<
  SupportedPaymentProvider,
  {
    requiredEnvKeys: readonly string[];
    requiredCredentialKeys: readonly string[];
  }
> = {
  paystack: {
    requiredEnvKeys: ['PAYSTACK_SECRET_KEY', 'PAYMENT_SMOKE_PAYSTACK_EMAIL'],
    requiredCredentialKeys: ['PAYSTACK_SECRET_KEY'],
  },
  momo: {
    requiredEnvKeys: [
      'MTN_MOMO_API_KEY',
      'MTN_MOMO_API_SECRET',
      'MTN_MOMO_SUBSCRIPTION_KEY',
      'MTN_MOMO_ENVIRONMENT',
      'PAYMENT_SMOKE_MOMO_PHONE',
      'PAYMENT_SMOKE_MOMO_CURRENCY',
    ],
    requiredCredentialKeys: [
      'MTN_MOMO_API_KEY',
      'MTN_MOMO_API_SECRET',
      'MTN_MOMO_SUBSCRIPTION_KEY',
    ],
  },
};

function loadLocalEnvFiles(): void {
  for (const fileName of ['.env.local', '.env']) {
    const filePath = resolve(process.cwd(), fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    const contents = readFileSync(filePath, 'utf8');

    for (const rawLine of contents.split(/\r?\n/u)) {
      const line = rawLine.trim();

      if (!line || line.startsWith('#')) {
        continue;
      }

      const separatorIndex = line.indexOf('=');

      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (!(key in process.env)) {
        process.env[key] = stripWrappingQuotes(value);
      }
    }
  }
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function resolveSmokeProviders(
  env: EnvMap = process.env,
): SupportedPaymentProvider[] {
  const explicitProviders = getOptionalEnv('PAYMENT_SMOKE_PROVIDERS', env);
  const pilotProviders = getOptionalEnv('PILOT_ALLOWED_PAYMENT_PROVIDERS', env);
  const raw = explicitProviders ?? pilotProviders;

  if (!raw) {
    return [...SUPPORTED_PAYMENT_PROVIDERS];
  }

  const providers = raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (providers.length === 0) {
    throw new Error(
      'PAYMENT_SMOKE_PROVIDERS must contain at least one provider when set.',
    );
  }

  const invalid = providers.filter(
    (provider) => !SUPPORTED_PAYMENT_PROVIDERS.includes(provider as SupportedPaymentProvider),
  );

  if (invalid.length > 0) {
    throw new Error(
      `Unsupported payment smoke provider(s): ${invalid.join(', ')}. Supported values: ${SUPPORTED_PAYMENT_PROVIDERS.join(', ')}.`,
    );
  }

  return [...new Set(providers)] as SupportedPaymentProvider[];
}

export function assertRequiredEnvSet(
  providers: readonly SupportedPaymentProvider[],
  env: EnvMap = process.env,
): void {
  const missing = providers.flatMap(
    (provider) =>
      PROVIDER_ENV_REQUIREMENTS[provider].requiredEnvKeys.filter(
        (key) => !getOptionalEnv(key, env),
      ),
  );

  if (missing.length > 0) {
    const envFilesPresent = ['.env.local', '.env']
      .map((fileName) => resolve(process.cwd(), fileName))
      .filter((filePath) => existsSync(filePath));

    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}${
        envFilesPresent.length === 0
          ? '. No .env or .env.local file was found in the workspace root.'
          : ''
      }`,
    );
  }
}

export function assertNonPlaceholderCredentials(
  providers: readonly SupportedPaymentProvider[],
  env: EnvMap = process.env,
): void {
  const placeholderKeys = providers.flatMap((provider) =>
    PROVIDER_ENV_REQUIREMENTS[provider].requiredCredentialKeys.filter((key) => {
      const value = getOptionalEnv(key, env);

      return (
        !value ||
        value.includes('replace-with-') ||
        value === 'sk_test_replace_with_real_key'
      );
    }),
  );

  if (placeholderKeys.length > 0) {
    throw new Error(
      `Replace placeholder provider credentials before running smoke validation: ${[...new Set(placeholderKeys)].join(', ')}`,
    );
  }
}

function getRequiredEnv(key: string, env: EnvMap = process.env): string {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function getOptionalEnv(key: string, env: EnvMap = process.env): string | undefined {
  return env[key]?.trim() || undefined;
}

function toPrintable(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, entry) => (typeof entry === 'bigint' ? entry.toString() : entry),
    2,
  );
}

function createConfigShim(env: EnvMap = process.env): AppConfigService {
  return {
    getOrThrow(key: string): string {
      return getRequiredEnv(key, env);
    },
  } as AppConfigService;
}

export function assertSafeLiveUsage(
  providers: readonly SupportedPaymentProvider[],
  env: EnvMap = process.env,
): void {
  const allowLive = getOptionalEnv('PAYMENT_SMOKE_ALLOW_LIVE', env) === 'true';
  const paystackKey = getOptionalEnv('PAYSTACK_SECRET_KEY', env);
  const momoEnvironment = getOptionalEnv('MTN_MOMO_ENVIRONMENT', env);

  if (
    providers.includes('paystack') &&
    paystackKey?.startsWith('sk_live_') &&
    !allowLive
  ) {
    throw new Error(
      'Refusing to run Paystack smoke against a live secret key without PAYMENT_SMOKE_ALLOW_LIVE=true.',
    );
  }

  if (
    providers.includes('momo') &&
    momoEnvironment === 'production' &&
    !allowLive
  ) {
    throw new Error(
      'Refusing to run MoMo smoke against production without PAYMENT_SMOKE_ALLOW_LIVE=true.',
    );
  }
}

async function runPaystack(
  config: AppConfigService,
  env: EnvMap = process.env,
): Promise<SmokeResult> {
  const adapter = new PaystackAdapter(config);
  const email = getRequiredEnv('PAYMENT_SMOKE_PAYSTACK_EMAIL', env);
  const callbackUrl = getOptionalEnv('PAYMENT_SMOKE_PAYSTACK_CALLBACK_URL', env);
  const amountMinor = BigInt(
    getOptionalEnv('PAYMENT_SMOKE_PAYSTACK_AMOUNT_MINOR', env) ?? '5000',
  );
  const currency = getOptionalEnv('PAYMENT_SMOKE_PAYSTACK_CURRENCY', env) ?? 'NGN';

  const initiated = await adapter.initiatePayment({
    orderId: randomUUID(),
    providerRef: randomUUID(),
    amountMinor,
    currency,
    customerEmail: email,
    callbackUrl,
  });

  const verified = await adapter.verifyPayment(initiated.providerRef);

  return {
    provider: 'paystack',
    initiated,
    verified,
  };
}

async function runMomo(
  config: AppConfigService,
  env: EnvMap = process.env,
): Promise<SmokeResult> {
  const adapter = new MomoAdapter(config);
  const phone = getRequiredEnv('PAYMENT_SMOKE_MOMO_PHONE', env);
  const amountMinor = BigInt(
    getOptionalEnv('PAYMENT_SMOKE_MOMO_AMOUNT_MINOR', env) ?? '500',
  );
  const currency = getRequiredEnv('PAYMENT_SMOKE_MOMO_CURRENCY', env);

  const initiated = await adapter.initiatePayment({
    orderId: randomUUID(),
    providerRef: randomUUID(),
    amountMinor,
    currency,
    customerPhone: phone,
  });

  const verified = await adapter.verifyPayment(initiated.providerRef);

  return {
    provider: 'momo',
    initiated,
    verified,
  };
}

async function main(): Promise<void> {
  loadLocalEnvFiles();
  const providers = resolveSmokeProviders();

  assertRequiredEnvSet(providers);
  assertNonPlaceholderCredentials(providers);
  assertSafeLiveUsage(providers);

  const config = createConfigShim();
  const results: SmokeResult[] = [];

  console.log(
    `Starting payment provider smoke validation for: ${providers.join(', ')}`,
  );

  for (const provider of providers) {
    if (provider === 'paystack') {
      results.push(await runPaystack(config));
      continue;
    }

    results.push(await runMomo(config));
  }

  for (const result of results) {
    console.log(`\n[${result.provider.toUpperCase()}] initiated`);
    console.log(toPrintable(result.initiated));

    if (result.verified) {
      console.log(`[${result.provider.toUpperCase()}] verified`);
      console.log(toPrintable(result.verified));
    }
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Payment smoke failed: ${message}`);
    process.exitCode = 1;
  });
}