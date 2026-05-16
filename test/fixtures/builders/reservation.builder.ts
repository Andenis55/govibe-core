import { ReservationStatus } from '@prisma/client';

export class ReservationBuilder {
  private data = {
    id: '30000000-0000-4000-8000-000000000001',
    ownerUserId: 'user-1',
    eventId: '30000000-0000-4000-8000-000000000002',
    ticketTypeId: '30000000-0000-4000-8000-000000000003',
    quantity: 2,
    status: ReservationStatus.HELD as ReservationStatus,
    expiresAt: new Date('2026-06-01T21:00:00.000Z'),
  };

  with<K extends keyof typeof this.data>(key: K, value: (typeof this.data)[K]): this {
    this.data[key] = value;
    return this;
  }

  build(): typeof this.data {
    return { ...this.data };
  }
}