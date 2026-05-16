import { Module } from '@nestjs/common';
import { SendEmailNotificationUseCase } from './application/use-cases/send-email-notification.use-case';
import { SendPushNotificationUseCase } from './application/use-cases/send-push-notification.use-case';
import { SendSmsNotificationUseCase } from './application/use-cases/send-sms-notification.use-case';
import { ConfigModule } from '../../shared/config/config.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { OutboxModule } from '../../shared/outbox/outbox.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';

const notificationUseCases = [
  SendEmailNotificationUseCase,
  SendSmsNotificationUseCase,
  SendPushNotificationUseCase,
];

@Module({
  imports: [ConfigModule, LoggingModule, TelemetryModule, OutboxModule],
  controllers: [],
  providers: [...notificationUseCases],
  exports: [...notificationUseCases],
})
export class NotificationsModule {}