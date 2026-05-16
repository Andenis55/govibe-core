import { Injectable } from '@nestjs/common';

@Injectable()
export class PublishEventMetricsUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
