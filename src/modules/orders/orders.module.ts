import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { CompleteOrderUseCase } from './application/use-cases/complete-order.use-case';
import { CreateOrderUseCase } from './application/use-cases/create-order.use-case';
import { ExpireOrderUseCase } from './application/use-cases/expire-order.use-case';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ORDER_REPOSITORY } from './orders.tokens';
import { PrismaOrderRepository } from './infrastructure/repositories/prisma-order.repository';
import { IdempotencyModule } from '../../shared/idempotency/idempotency.module';
import { LaunchControlModule } from '../../shared/launch-control/launch-control.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { OutboxModule } from '../../shared/outbox/outbox.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';
import { CheckoutController } from './controllers/checkout.controller';

const orderUseCases = [
  CreateOrderUseCase,
  ExpireOrderUseCase,
  CompleteOrderUseCase,
];

@Module({
  imports: [
    AuthModule,
    PrismaModule,
    RedisModule,
    LoggingModule,
    TelemetryModule,
    LaunchControlModule,
    IdempotencyModule,
    OutboxModule,
    InventoryModule,
    AuditModule,
  ],
  controllers: [CheckoutController],
  providers: [
    ...orderUseCases,
    {
      provide: ORDER_REPOSITORY,
      useClass: PrismaOrderRepository,
    },
  ],
  exports: [...orderUseCases, ORDER_REPOSITORY],
})
export class OrdersModule {}