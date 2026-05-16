import { Injectable } from '@nestjs/common';

@Injectable()
export class SendPushNotificationUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
