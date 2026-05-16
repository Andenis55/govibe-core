import { Module } from '@nestjs/common';
import { FlagSuspiciousEventUseCase } from './application/use-cases/flag-suspicious-event.use-case';
import { ScoreDeviceRiskUseCase } from './application/use-cases/score-device-risk.use-case';
import { ScoreTicketRiskUseCase } from './application/use-cases/score-ticket-risk.use-case';
import { LoggingModule } from '../../shared/logging/logging.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';

const fraudUseCases = [
  FlagSuspiciousEventUseCase,
  ScoreDeviceRiskUseCase,
  ScoreTicketRiskUseCase,
];

@Module({
  imports: [PrismaModule, RedisModule, LoggingModule, TelemetryModule],
  controllers: [],
  providers: [...fraudUseCases],
  exports: [...fraudUseCases],
})
export class FraudModule {}