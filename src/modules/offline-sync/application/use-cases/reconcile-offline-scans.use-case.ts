import { Injectable } from '@nestjs/common';

@Injectable()
export class ReconcileOfflineScansUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
