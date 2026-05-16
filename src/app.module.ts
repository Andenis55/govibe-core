import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AuthModule as IdentityAuthModule } from './auth/auth.module';
import { EventsModule } from './events/events.module';
import { OrganizersModule } from './organizers/organizers.module';
import { PrismaModule } from './prisma/prisma.module';
import { AdmissionsModule } from './modules/admissions/admissions.module';
import { AdminSupportModule } from './modules/admin-support/admin-support.module';
import { AuditModule } from './modules/audit/audit.module';
import { FraudModule } from './modules/fraud/fraud.module';
import { HealthModule } from './modules/health/health.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OfflineSyncModule } from './modules/offline-sync/offline-sync.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { AuthModule as SharedAuthModule } from './shared/auth/auth.module';
import { ConfigModule } from './shared/config/config.module';
import { ContextModule } from './shared/context/context.module';
import { RequestContextMiddleware } from './shared/context/request-context.middleware';
import { ErrorsModule } from './shared/errors/errors.module';
import { GlobalExceptionFilter } from './shared/errors/global-exception.filter';
import { RawBodyMiddleware } from './shared/http/raw-body.middleware';
import { IdempotencyModule } from './shared/idempotency/idempotency.module';
import { CorrelationInterceptor } from './shared/interceptors/correlation.interceptor';
import { LoggingModule } from './shared/logging/logging.module';
import { OutboxModule } from './shared/outbox/outbox.module';
import { RedisModule } from './shared/redis/redis.module';
import { TelemetryModule } from './shared/telemetry/telemetry.module';
import { TablesModule } from './tables/tables.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ContextModule,
    ConfigModule,
    LoggingModule,
    TelemetryModule,
    PrismaModule,
    UsersModule,
    RedisModule,
    SharedAuthModule,
    IdentityAuthModule,
    IdempotencyModule,
    OutboxModule,
    ErrorsModule,
    HealthModule,
    AdminSupportModule,
    OrganizersModule,
    EventsModule,
    TablesModule,
    InventoryModule,
    OrdersModule,
    PaymentsModule,
    TicketsModule,
    AdmissionsModule,
    OfflineSyncModule,
    FraudModule,
    AuditModule,
    NotificationsModule,
    RealtimeModule,
  ],
  providers: [
    CorrelationInterceptor,
    {
      provide: APP_FILTER,
      useExisting: GlobalExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestContextMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });

    consumer.apply(RawBodyMiddleware).forRoutes({
      path: 'payments/webhooks/:provider',
      method: RequestMethod.POST,
    });
  }
}
