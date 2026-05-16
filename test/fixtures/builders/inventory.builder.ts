export class InventoryBuilder {
  private data = {
    id: '20000000-0000-4000-8000-000000000001',
    eventId: '20000000-0000-4000-8000-000000000002',
    ticketTypeId: '20000000-0000-4000-8000-000000000003',
    capacityTotal: 100,
    reservedCount: 0,
    soldCount: 0,
  };

  with<K extends keyof typeof this.data>(key: K, value: (typeof this.data)[K]): this {
    this.data[key] = value;
    return this;
  }

  build(): typeof this.data {
    return { ...this.data };
  }
}