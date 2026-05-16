import { OrderStatus } from '@prisma/client';
import { SupportedCurrency } from '../../../src/shared/constants/payment.constants';

export class OrderBuilder {
  private data = {
    id: '40000000-0000-4000-8000-000000000001',
    userId: '40000000-0000-4000-8000-000000000002',
    eventId: '40000000-0000-4000-8000-000000000003',
    reservationId: '40000000-0000-4000-8000-000000000004',
    totalAmount: BigInt(5000),
    currency: 'GHS' as SupportedCurrency,
    status: OrderStatus.RESERVED as OrderStatus,
  };

  with<K extends keyof typeof this.data>(key: K, value: (typeof this.data)[K]): this {
    this.data[key] = value;
    return this;
  }

  build(): typeof this.data {
    return { ...this.data };
  }
}