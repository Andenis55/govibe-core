import { Injectable } from '@nestjs/common';

@Injectable()
export class RecordEntryUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
