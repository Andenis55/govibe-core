import { Injectable } from '@nestjs/common';

@Injectable()
export class RecordExitUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
