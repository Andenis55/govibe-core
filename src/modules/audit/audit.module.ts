import { Module } from '@nestjs/common';
import { AppendAuditLogUseCase } from './application/use-cases/append-audit-log.use-case';
import { AUDIT_LOG_REPOSITORY } from './infrastructure/providers/audit.providers';
import { PrismaAuditLogRepository } from './infrastructure/repositories/prisma-audit-log.repository';
import { LoggingModule } from '../../shared/logging/logging.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';

@Module({
  imports: [PrismaModule, LoggingModule, TelemetryModule],
  controllers: [],
  providers: [
    AppendAuditLogUseCase,
    {
      provide: AUDIT_LOG_REPOSITORY,
      useClass: PrismaAuditLogRepository,
    },
  ],
  exports: [AppendAuditLogUseCase, AUDIT_LOG_REPOSITORY],
})
export class AuditModule {}