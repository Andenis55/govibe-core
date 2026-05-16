import { Module } from '@nestjs/common';
import { PublishAdmissionUpdateUseCase } from './application/use-cases/publish-admission-update.use-case';
import { PublishEventMetricsUseCase } from './application/use-cases/publish-event-metrics.use-case';
import { PublishFraudAlertUseCase } from './application/use-cases/publish-fraud-alert.use-case';
import { AdmissionsGateway } from './gateways/admissions.gateway';
import { EventsGateway } from './gateways/events.gateway';
import { FraudAlertsGateway } from './gateways/fraud-alerts.gateway';
import { OrganizerDashboardGateway } from './gateways/organizer-dashboard.gateway';
import { AuthModule } from '../../shared/auth/auth.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';

const realtimeUseCases = [
  PublishAdmissionUpdateUseCase,
  PublishEventMetricsUseCase,
  PublishFraudAlertUseCase,
];

const realtimeGateways = [
  AdmissionsGateway,
  EventsGateway,
  OrganizerDashboardGateway,
  FraudAlertsGateway,
];

@Module({
  imports: [AuthModule, RedisModule, LoggingModule, TelemetryModule],
  controllers: [],
  providers: [...realtimeUseCases, ...realtimeGateways],
  exports: [...realtimeUseCases, ...realtimeGateways],
})
export class RealtimeModule {}