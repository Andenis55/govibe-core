import { Injectable } from '@nestjs/common';

@Injectable()
export class ScoreDeviceRiskUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
