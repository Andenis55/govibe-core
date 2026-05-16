import { Injectable } from '@nestjs/common';

@Injectable()
export class PublishAdmissionUpdateUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
