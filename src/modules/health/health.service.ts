import { Injectable } from '@nestjs/common';
import { BuildMetadataService } from './checks/build-metadata.service';
import { DatabaseHealthCheck } from './checks/database-health.check';
import { RedisHealthCheck } from './checks/redis-health.check';
import { RollbackHealthCheck } from './checks/rollback-health.check';
import {
  LivenessHealthResponse,
  ReadinessHealthResponse,
  SummaryHealthResponse,
} from './health.types';

const HEALTH_SERVICE_NAME = 'govibe-api';

@Injectable()
export class HealthService {
  constructor(
    private readonly databaseHealthCheck: DatabaseHealthCheck,
    private readonly redisHealthCheck: RedisHealthCheck,
    private readonly rollbackHealthCheck: RollbackHealthCheck,
    private readonly buildMetadataService: BuildMetadataService,
  ) {}

  getLiveness(): LivenessHealthResponse {
    return {
      status: 'ok',
      service: HEALTH_SERVICE_NAME,
      check: 'liveness',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async getReadiness(): Promise<ReadinessHealthResponse> {
    const database = await this.databaseHealthCheck.check();
    const redis = await this.redisHealthCheck.checkIfAvailable();

    const dependencies: ReadinessHealthResponse['dependencies'] = {
      database,
    };

    if (redis.status !== 'skipped') {
      dependencies.redis = redis;
    }

    let status: ReadinessHealthResponse['status'] = 'ready';

    if (database.status === 'fail') {
      status = 'not_ready';
    } else if (redis.status === 'fail') {
      status = 'degraded';
    }

    return {
      status,
      service: HEALTH_SERVICE_NAME,
      check: 'readiness',
      timestamp: new Date().toISOString(),
      dependencies,
      rollback: this.rollbackHealthCheck.check(),
      build: this.buildMetadataService.getBuildMetadata(),
    };
  }

  getSummary(): SummaryHealthResponse {
    return {
      status: 'ok',
      service: HEALTH_SERVICE_NAME,
      check: 'summary',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      build: this.buildMetadataService.getBuildMetadata(),
    };
  }
}