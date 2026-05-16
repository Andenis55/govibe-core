import { PaymentStatus } from '@prisma/client';
import { SupportedPaymentProvider } from '../../../src/shared/constants/payment.constants';

export class PaymentBuilder {
  private data = {
    id: '50000000-0000-4000-8000-000000000001',
    orderId: '50000000-0000-4000-8000-000000000002',
    provider: 'paystack' as SupportedPaymentProvider,
    providerRef: 'provider-ref-001',
    status: PaymentStatus.PENDING as PaymentStatus,
    amount: BigInt(5000),
  };

  with<K extends keyof typeof this.data>(key: K, value: (typeof this.data)[K]): this {
    this.data[key] = value;
    return this;
  }

  build(): typeof this.data {
    return { ...this.data };
  }
}