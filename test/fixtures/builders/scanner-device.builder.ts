export class ScannerDeviceBuilder {
  private data = {
    deviceId: '80000000-0000-4000-8000-000000000001',
    organizerId: '80000000-0000-4000-8000-000000000002',
    gateId: 'gate-a',
    label: 'Scanner A',
    permissions: ['admissions:scan'],
  };

  with<K extends keyof typeof this.data>(key: K, value: (typeof this.data)[K]): this {
    this.data[key] = value;
    return this;
  }

  build(): typeof this.data {
    return {
      ...this.data,
      permissions: [...this.data.permissions],
    };
  }
}