import { Injectable } from '@nestjs/common';

@Injectable()
export class PublishFraudAlertUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
