import { Injectable } from '@nestjs/common';

@Injectable()
export class ExpireOrderUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
