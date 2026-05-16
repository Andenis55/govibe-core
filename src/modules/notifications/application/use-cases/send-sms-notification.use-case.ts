import { Injectable } from '@nestjs/common';

@Injectable()
export class SendSmsNotificationUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
