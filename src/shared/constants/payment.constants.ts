export const SUPPORTED_PAYMENT_PROVIDERS = ['paystack', 'momo'] as const;

export type SupportedPaymentProvider =
  (typeof SUPPORTED_PAYMENT_PROVIDERS)[number];

export const SUPPORTED_CURRENCIES = ['GHS', 'NGN'] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];