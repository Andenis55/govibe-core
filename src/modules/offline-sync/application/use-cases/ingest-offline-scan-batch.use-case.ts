import { Injectable } from '@nestjs/common';

@Injectable()
export class IngestOfflineScanBatchUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
