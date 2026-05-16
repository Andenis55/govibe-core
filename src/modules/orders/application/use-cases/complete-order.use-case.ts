import { Injectable } from '@nestjs/common';

@Injectable()
export class CompleteOrderUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
