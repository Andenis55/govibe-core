import { Injectable } from '@nestjs/common';

@Injectable()
export class FlagSuspiciousEventUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
