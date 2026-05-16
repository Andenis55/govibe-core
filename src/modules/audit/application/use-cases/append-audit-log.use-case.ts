import { Injectable } from '@nestjs/common';

@Injectable()
export class AppendAuditLogUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
