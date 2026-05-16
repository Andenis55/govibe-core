import { Injectable } from '@nestjs/common';

@Injectable()
export class ScoreTicketRiskUseCase {
  async execute(_input: unknown): Promise<void> {
    return Promise.resolve();
  }
}
