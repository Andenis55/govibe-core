import { Injectable } from '@nestjs/common';

@Injectable()
export class SendEmailNotificationUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
