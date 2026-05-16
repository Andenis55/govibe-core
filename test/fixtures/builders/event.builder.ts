export class EventBuilder {
  private data = {
    id: '10000000-0000-4000-8000-000000000001',
    organizerId: '10000000-0000-4000-8000-000000000002',
    title: 'GoVibe Test Event',
    slug: 'govibe-test-event',
    venueId: '10000000-0000-4000-8000-000000000003',
    startsAt: new Date('2026-06-01T20:00:00.000Z'),
    endsAt: new Date('2026-06-02T02:00:00.000Z'),
    capacityTotal: 500,
    status: 'PUBLISHED',
    venueName: 'Accra Hall',
    city: 'Accra',
    country: 'Ghana',
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
  };

  with<K extends keyof typeof this.data>(key: K, value: (typeof this.data)[K]): this {
    this.data[key] = value;
    return this;
  }

  build(): typeof this.data {
    return { ...this.data };
  }
}