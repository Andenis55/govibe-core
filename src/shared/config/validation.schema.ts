import {
  SUPPORTED_CURRENCIES,
  SUPPORTED_PAYMENT_PROVIDERS,
  type SupportedCurrency,
  type SupportedPaymentProvider,
} from '../constants/payment.constants';

export type NodeEnvironment = 'development' | 'test' | 'production';
export type MomoEnvironment = 'sandbox' | 'production';

const UUID_LIST_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AppConfigValues {
  APP_NAME: string;
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL: number;
  JWT_REFRESH_TTL: number;
  PAYSTACK_SECRET_KEY: string;
  PAYSTACK_BASE_URL?: string;
  PAYMENT_PROVIDER_TIMEOUT_MS?: number;
  MTN_MOMO_API_KEY: string;
  MTN_MOMO_API_SECRET: string;
  MTN_MOMO_SUBSCRIPTION_KEY: string;
  MTN_MOMO_ENVIRONMENT: MomoEnvironment;
  MTN_MOMO_BASE_URL?: string;
  MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY?: string;
  MTN_MOMO_API_USER?: string;
  MTN_MOMO_TARGET_ENVIRONMENT?: MomoEnvironment;
  MTN_MOMO_WEBHOOK_SECRET?: string;
  QR_HMAC_ACTIVE_KID: string;
  QR_HMAC_ACTIVE_SECRET: string;
  API_BASE_URL: string;
  SENTRY_DSN?: string;
  PILOT_CHECKOUT_ENABLED?: boolean;
  PILOT_PAYMENTS_ENABLED?: boolean;
  PILOT_ADMISSIONS_ENABLED?: boolean;
  PILOT_ALLOWED_PAYMENT_PROVIDERS?: SupportedPaymentProvider[];
  PILOT_ALLOWED_CURRENCIES?: SupportedCurrency[];
  PILOT_ALLOWED_ORGANIZER_IDS?: string[];
  PILOT_ALLOWED_EVENT_IDS?: string[];
  PILOT_ALLOWED_GATE_IDS?: string[];
}

export const validationSchema = {
  APP_NAME: 'string',
  NODE_ENV: ['development', 'test', 'production'],
  PORT: 'number',
  DATABASE_URL: 'url',
  REDIS_URL: 'url',
  JWT_ACCESS_SECRET: 'secret',
  JWT_REFRESH_SECRET: 'secret',
  JWT_ACCESS_TTL: 'number',
  JWT_REFRESH_TTL: 'number',
  PAYSTACK_SECRET_KEY: 'secret',
  PAYSTACK_BASE_URL: 'optional-url',
  PAYMENT_PROVIDER_TIMEOUT_MS: 'optional-number',
  MTN_MOMO_API_KEY: 'secret',
  MTN_MOMO_API_SECRET: 'secret',
  MTN_MOMO_SUBSCRIPTION_KEY: 'secret',
  MTN_MOMO_ENVIRONMENT: ['sandbox', 'production'],
  MTN_MOMO_BASE_URL: 'optional-url',
  MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY: 'optional-secret',
  MTN_MOMO_API_USER: 'optional-string',
  MTN_MOMO_TARGET_ENVIRONMENT: ['sandbox', 'production'],
  MTN_MOMO_WEBHOOK_SECRET: 'optional-secret',
  QR_HMAC_ACTIVE_KID: 'string',
  QR_HMAC_ACTIVE_SECRET: 'secret',
  API_BASE_URL: 'url',
  SENTRY_DSN: 'optional-url',
  PILOT_CHECKOUT_ENABLED: 'optional-boolean',
  PILOT_PAYMENTS_ENABLED: 'optional-boolean',
  PILOT_ADMISSIONS_ENABLED: 'optional-boolean',
  PILOT_ALLOWED_PAYMENT_PROVIDERS: 'optional-provider-list',
  PILOT_ALLOWED_CURRENCIES: 'optional-currency-list',
  PILOT_ALLOWED_ORGANIZER_IDS: 'optional-uuid-list',
  PILOT_ALLOWED_EVENT_IDS: 'optional-uuid-list',
  PILOT_ALLOWED_GATE_IDS: 'optional-uuid-list',
} as const;

function getRequiredValue(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(`Missing required configuration value: ${key}`);
  }

  return value;
}

function getNumber(env: NodeJS.ProcessEnv, key: string): number {
  const value = Number(getRequiredValue(env, key));

  if (!Number.isFinite(value)) {
    throw new Error(`Configuration value ${key} must be a number`);
  }

  return value;
}

function getUrl(env: NodeJS.ProcessEnv, key: string): string {
  const value = getRequiredValue(env, key);

  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`Configuration value ${key} must be a valid URL`);
  }
}

function getOptionalUrl(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();

  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`Configuration value ${key} must be a valid URL`);
  }
}

function getOptionalNumber(
  env: NodeJS.ProcessEnv,
  key: string,
): number | undefined {
  const value = env[key]?.trim();

  if (!value) {
    return undefined;
  }

  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    throw new Error(`Configuration value ${key} must be a number`);
  }

  return parsedValue;
}

function getSecret(env: NodeJS.ProcessEnv, key: string): string {
  const value = getRequiredValue(env, key);

  if (value.length < 16) {
    throw new Error(`Configuration value ${key} must be at least 16 characters`);
  }

  return value;
}

function getOptionalBoolean(
  env: NodeJS.ProcessEnv,
  key: string,
): boolean | undefined {
  const value = env[key]?.trim().toLowerCase();

  if (!value) {
    return undefined;
  }

  if (value !== 'true' && value !== 'false') {
    throw new Error(`Configuration value ${key} must be true or false`);
  }

  return value === 'true';
}

function getOptionalCsvList(
  env: NodeJS.ProcessEnv,
  key: string,
): string[] | undefined {
  const value = env[key]?.trim();

  if (!value) {
    return undefined;
  }

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (items.length === 0) {
    throw new Error(`Configuration value ${key} must contain at least one entry`);
  }

  return items;
}

function getOptionalEnumList<T extends string>(
  env: NodeJS.ProcessEnv,
  key: string,
  values: readonly T[],
): T[] | undefined {
  const items = getOptionalCsvList(env, key);

  if (!items) {
    return undefined;
  }

  const invalid = items.filter((item) => !values.includes(item as T));

  if (invalid.length > 0) {
    throw new Error(
      `Configuration value ${key} must contain only: ${values.join(', ')}`,
    );
  }

  return items as T[];
}

function getOptionalUuidList(
  env: NodeJS.ProcessEnv,
  key: string,
): string[] | undefined {
  const items = getOptionalCsvList(env, key);

  if (!items) {
    return undefined;
  }

  const invalid = items.filter((item) => !UUID_LIST_PATTERN.test(item));

  if (invalid.length > 0) {
    throw new Error(
      `Configuration value ${key} must contain only UUID values`,
    );
  }

  return items;
}

function getOptionalSecret(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const value = env[key]?.trim();

  if (!value) {
    return undefined;
  }

  if (value.length < 16) {
    throw new Error(`Configuration value ${key} must be at least 16 characters`);
  }

  return value;
}

function getOptionalString(
  env: NodeJS.ProcessEnv,
  key: string,
): string | undefined {
  const value = env[key]?.trim();

  return value || undefined;
}

function getString(env: NodeJS.ProcessEnv, key: string): string {
  return getRequiredValue(env, key);
}

function getEnumValue<T extends string>(
  env: NodeJS.ProcessEnv,
  key: string,
  values: readonly T[],
): T {
  const value = getRequiredValue(env, key) as T;

  if (!values.includes(value)) {
    throw new Error(`Configuration value ${key} must be one of: ${values.join(', ')}`);
  }

  return value;
}

export function validateConfig(env: NodeJS.ProcessEnv = process.env): AppConfigValues {
  const config: AppConfigValues = {
    APP_NAME: getString(env, 'APP_NAME'),
    NODE_ENV: getEnumValue(env, 'NODE_ENV', validationSchema.NODE_ENV),
    PORT: getNumber(env, 'PORT'),
    DATABASE_URL: getUrl(env, 'DATABASE_URL'),
    REDIS_URL: getUrl(env, 'REDIS_URL'),
    JWT_ACCESS_SECRET: getSecret(env, 'JWT_ACCESS_SECRET'),
    JWT_REFRESH_SECRET: getSecret(env, 'JWT_REFRESH_SECRET'),
    JWT_ACCESS_TTL: getNumber(env, 'JWT_ACCESS_TTL'),
    JWT_REFRESH_TTL: getNumber(env, 'JWT_REFRESH_TTL'),
    PAYSTACK_SECRET_KEY: getSecret(env, 'PAYSTACK_SECRET_KEY'),
    PAYSTACK_BASE_URL: getOptionalUrl(env, 'PAYSTACK_BASE_URL'),
    PAYMENT_PROVIDER_TIMEOUT_MS: getOptionalNumber(
      env,
      'PAYMENT_PROVIDER_TIMEOUT_MS',
    ),
    MTN_MOMO_API_KEY: getSecret(env, 'MTN_MOMO_API_KEY'),
    MTN_MOMO_API_SECRET: getSecret(env, 'MTN_MOMO_API_SECRET'),
    MTN_MOMO_SUBSCRIPTION_KEY: getSecret(env, 'MTN_MOMO_SUBSCRIPTION_KEY'),
    MTN_MOMO_ENVIRONMENT: getEnumValue(
      env,
      'MTN_MOMO_ENVIRONMENT',
      validationSchema.MTN_MOMO_ENVIRONMENT,
    ),
    MTN_MOMO_BASE_URL: getOptionalUrl(env, 'MTN_MOMO_BASE_URL'),
    MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY: getOptionalSecret(
      env,
      'MTN_MOMO_COLLECTION_SUBSCRIPTION_KEY',
    ),
    MTN_MOMO_API_USER: getOptionalString(env, 'MTN_MOMO_API_USER'),
    MTN_MOMO_TARGET_ENVIRONMENT: getOptionalString(
      env,
      'MTN_MOMO_TARGET_ENVIRONMENT',
    ) as MomoEnvironment | undefined,
    MTN_MOMO_WEBHOOK_SECRET: getOptionalSecret(env, 'MTN_MOMO_WEBHOOK_SECRET'),
    QR_HMAC_ACTIVE_KID: getString(env, 'QR_HMAC_ACTIVE_KID'),
    QR_HMAC_ACTIVE_SECRET: getSecret(env, 'QR_HMAC_ACTIVE_SECRET'),
    API_BASE_URL: getUrl(env, 'API_BASE_URL'),
    SENTRY_DSN: getOptionalUrl(env, 'SENTRY_DSN'),
    PILOT_CHECKOUT_ENABLED: getOptionalBoolean(env, 'PILOT_CHECKOUT_ENABLED'),
    PILOT_PAYMENTS_ENABLED: getOptionalBoolean(env, 'PILOT_PAYMENTS_ENABLED'),
    PILOT_ADMISSIONS_ENABLED: getOptionalBoolean(env, 'PILOT_ADMISSIONS_ENABLED'),
    PILOT_ALLOWED_PAYMENT_PROVIDERS: getOptionalEnumList(
      env,
      'PILOT_ALLOWED_PAYMENT_PROVIDERS',
      SUPPORTED_PAYMENT_PROVIDERS,
    ),
    PILOT_ALLOWED_CURRENCIES: getOptionalEnumList(
      env,
      'PILOT_ALLOWED_CURRENCIES',
      SUPPORTED_CURRENCIES,
    ),
    PILOT_ALLOWED_ORGANIZER_IDS: getOptionalUuidList(
      env,
      'PILOT_ALLOWED_ORGANIZER_IDS',
    ),
    PILOT_ALLOWED_EVENT_IDS: getOptionalUuidList(env, 'PILOT_ALLOWED_EVENT_IDS'),
    PILOT_ALLOWED_GATE_IDS: getOptionalUuidList(env, 'PILOT_ALLOWED_GATE_IDS'),
  };

  if (config.PORT < 1 || config.PORT > 65535) {
    throw new Error('Configuration value PORT must be between 1 and 65535');
  }

  if (config.JWT_ACCESS_TTL <= 0 || config.JWT_REFRESH_TTL <= 0) {
    throw new Error('JWT TTL values must be positive numbers');
  }

  if (
    config.PAYMENT_PROVIDER_TIMEOUT_MS !== undefined &&
    config.PAYMENT_PROVIDER_TIMEOUT_MS <= 0
  ) {
    throw new Error('PAYMENT_PROVIDER_TIMEOUT_MS must be a positive number');
  }

  return config;
}