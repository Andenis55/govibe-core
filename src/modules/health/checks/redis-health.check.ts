import { Injectable, Optional } from '@nestjs/common';
import { RedisService } from '../../../shared/redis/redis.service';
import { OptionalHealthDependencyResult } from '../health.types';

@Injectable()
export class RedisHealthCheck {
  constructor(@Optional() private readonly redisService?: RedisService) {}

  async checkIfAvailable(): Promise<OptionalHealthDependencyResult> {
    if (!this.redisService) {
      return {
        status: 'skipped',
        required: false,
        latencyMs: 0,
      };
    }

    const startedAt = Date.now();

    try {
      await this.redisService.ping();

      return {
        status: 'ok',
        required: false,
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      return {
        status: 'fail',
        required: false,
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}