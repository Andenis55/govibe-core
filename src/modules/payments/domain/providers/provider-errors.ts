export class ProviderAuthError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderAuthError';
  }
}

export class ProviderTimeoutError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderTimeoutError';
  }
}

export class ProviderNetworkError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderNetworkError';
  }
}

export class ProviderResponseError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
    public readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProviderResponseError';
  }
}

export class WebhookSignatureError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}
