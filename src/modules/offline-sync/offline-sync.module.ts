import { Module } from '@nestjs/common';
import { IngestOfflineScanBatchUseCase } from './application/use-cases/ingest-offline-scan-batch.use-case';
import { ReconcileOfflineScansUseCase } from './application/use-cases/reconcile-offline-scans.use-case';
import { AuthModule } from '../../shared/auth/auth.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';

const offlineSyncUseCases = [
  IngestOfflineScanBatchUseCase,
  ReconcileOfflineScansUseCase,
];

@Module({
  imports: [AuthModule, PrismaModule, LoggingModule, TelemetryModule],
  controllers: [],
  providers: [...offlineSyncUseCases],
  exports: [...offlineSyncUseCases],
})
export class OfflineSyncModule {}