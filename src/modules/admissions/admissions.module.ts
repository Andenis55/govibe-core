import { Module } from '@nestjs/common';
import { AdmissionsService } from './application/admissions.service';
import { AdmissionAuditService } from './application/admission-audit.service';
import { ValidateAdmissionScanUseCase } from './application/use-cases/validate-admission-scan.use-case';
import {
  ADMISSION_EVENT_REPOSITORY,
  ADMISSION_REPOSITORY,
  QR_TOKEN_VERIFIER,
} from './admissions.tokens';
import { PrismaAdmissionEventRepository } from './infrastructure/repositories/prisma-admission-event.repository';
import { PrismaAdmissionRepository } from './infrastructure/repositories/prisma-admission.repository';
import { AuditModule } from '../audit/audit.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AuthModule } from '../../auth/auth.module';
import { LaunchControlModule } from '../../shared/launch-control/launch-control.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { QrTokenVerifierService } from '../../shared/security/qr-token-verifier.service';
import { SecurityModule } from '../../shared/security/security.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';
import { AdmissionsController } from './controllers/admissions.controller';

const admissionUseCases = [
  AdmissionsService,
  AdmissionAuditService,
  ValidateAdmissionScanUseCase,
];

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    RedisModule,
    LoggingModule,
    TelemetryModule,
    LaunchControlModule,
    TicketsModule,
    AuditModule,
    SecurityModule,
  ],
  controllers: [AdmissionsController],
  providers: [
    ...admissionUseCases,
    {
      provide: ADMISSION_REPOSITORY,
      useClass: PrismaAdmissionRepository,
    },
    {
      provide: ADMISSION_EVENT_REPOSITORY,
      useClass: PrismaAdmissionEventRepository,
    },
    {
      provide: QR_TOKEN_VERIFIER,
      useExisting: QrTokenVerifierService,
    },
  ],
  exports: [
    ...admissionUseCases,
    ADMISSION_REPOSITORY,
    ADMISSION_EVENT_REPOSITORY,
    QR_TOKEN_VERIFIER,
  ],
})
export class AdmissionsModule {}