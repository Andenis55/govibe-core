export function applyTestEnv(): void {
  const defaults: Record<string, string> = {
    NODE_ENV: 'test',
    APP_NAME: 'govibe',
    PORT: '3001',
    DATABASE_URL:
      'postgresql://postgres:postgres@127.0.0.1:5432/govibe_test?schema=public',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_ACCESS_SECRET: 'test-access-secret-123456',
    JWT_REFRESH_SECRET: 'test-refresh-secret-123456',
    JWT_ACCESS_TTL: '900',
    JWT_REFRESH_TTL: '2592000',
    PAYSTACK_SECRET_KEY: 'sk_test_xxxxxxxxxxxxxxxx',
    MTN_MOMO_API_KEY: 'test-api-key-123456',
    MTN_MOMO_API_SECRET: 'test-api-secret-123456',
    MTN_MOMO_SUBSCRIPTION_KEY: 'test-sub-key-123456',
    MTN_MOMO_ENVIRONMENT: 'sandbox',
    QR_HMAC_ACTIVE_KID: 'test-kid-1',
    QR_HMAC_ACTIVE_SECRET: 'test-qr-secret-1234567890',
    API_BASE_URL: 'http://localhost:3001',
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}