import { TicketStatus } from '@prisma/client';

export class TicketBuilder {
  private data = {
    id: '60000000-0000-4000-8000-000000000001',
    orderId: '60000000-0000-4000-8000-000000000002',
    eventId: '60000000-0000-4000-8000-000000000003',
    publicReference: 'GVB-TICKET-001',
    serialNo: 'SERIAL-001',
    status: TicketStatus.ACTIVE as TicketStatus,
  };

  with<K extends keyof typeof this.data>(key: K, value: (typeof this.data)[K]): this {
    this.data[key] = value;
    return this;
  }

  build(): typeof this.data {
    return { ...this.data };
  }
}