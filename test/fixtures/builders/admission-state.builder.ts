import { AdmissionState } from '@prisma/client';

export class AdmissionStateBuilder {
  private data = {
    ticketId: '70000000-0000-4000-8000-000000000001',
    currentState: AdmissionState.NOT_USED as AdmissionState,
    admissionCycleNo: 0,
    version: 1,
    lastEntryAt: null as Date | null,
    lastExitAt: null as Date | null,
  };

  with<K extends keyof typeof this.data>(key: K, value: (typeof this.data)[K]): this {
    this.data[key] = value;
    return this;
  }

  build(): typeof this.data {
    return { ...this.data };
  }
}