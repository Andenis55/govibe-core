import { Module } from '@nestjs/common';
import { BuildMetadataService } from './checks/build-metadata.service';
import { DatabaseHealthCheck } from './checks/database-health.check';
import { RedisHealthCheck } from './checks/redis-health.check';
import { RollbackHealthCheck } from './checks/rollback-health.check';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  providers: [
    HealthService,
    DatabaseHealthCheck,
    RedisHealthCheck,
    RollbackHealthCheck,
    BuildMetadataService,
  ],
  controllers: [HealthController],
})
export class HealthModule {}