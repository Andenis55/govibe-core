import { Injectable } from '@nestjs/common';

@Injectable()
export class InvalidateTicketUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
