import { Injectable } from '@nestjs/common';
import { PaymentProvider } from '@prisma/client';
import { NotFoundError } from '../../../shared/errors/domain-errors';
import { MtnMomoVerificationAdapter } from './mtn-momo-verification.adapter';
import { PaystackVerificationAdapter } from './paystack-verification.adapter';
import { PaymentVerificationAdapter } from './provider-verification.types';

@Injectable()
export class ProviderVerificationRegistry {
  private readonly adapters: Map<PaymentProvider, PaymentVerificationAdapter>;

  constructor(
    paystackAdapter: PaystackVerificationAdapter,
    momoAdapter: MtnMomoVerificationAdapter,
  ) {
    this.adapters = new Map<PaymentProvider, PaymentVerificationAdapter>([
      [paystackAdapter.provider, paystackAdapter],
      [momoAdapter.provider, momoAdapter],
    ]);
  }

  get(provider: PaymentProvider): PaymentVerificationAdapter {
    const adapter = this.adapters.get(provider);

    if (!adapter) {
      throw new NotFoundError(
        `No payment verification adapter registered for ${provider}.`,
      );
    }

    return adapter;
  }
}