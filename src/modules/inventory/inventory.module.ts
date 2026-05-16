import { Module } from '@nestjs/common';
import { ReconcileInventoryDriftUseCase } from './application/use-cases/reconcile-inventory-drift.use-case';
import { ReleaseExpiredReservationUseCase } from './application/use-cases/release-expired-reservation.use-case';
import { ReserveInventoryUseCase } from './application/use-cases/reserve-inventory.use-case';
import { SweepExpiredReservationsUseCase } from './application/use-cases/sweep-expired-reservations.use-case';
import { PrismaInventoryRepository } from './infrastructure/repositories/prisma-inventory.repository';
import { PrismaReservationRepository } from './infrastructure/repositories/prisma-reservation.repository';
import { AuditModule } from '../audit/audit.module';
import {
  INVENTORY_REPOSITORY,
  RESERVATION_REPOSITORY,
} from './inventory.tokens';
import { LoggingModule } from '../../shared/logging/logging.module';
import { OutboxModule } from '../../shared/outbox/outbox.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { RedisModule } from '../../shared/redis/redis.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';

const inventoryUseCases = [
  ReserveInventoryUseCase,
  ReleaseExpiredReservationUseCase,
  ReconcileInventoryDriftUseCase,
  SweepExpiredReservationsUseCase,
];

const inventoryRepositoryProviders = [
  {
    provide: INVENTORY_REPOSITORY,
    useClass: PrismaInventoryRepository,
  },
  {
    provide: RESERVATION_REPOSITORY,
    useClass: PrismaReservationRepository,
  },
];

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    LoggingModule,
    TelemetryModule,
    OutboxModule,
    AuditModule,
  ],
  controllers: [],
  providers: [...inventoryUseCases, ...inventoryRepositoryProviders],
  exports: [...inventoryUseCases, INVENTORY_REPOSITORY, RESERVATION_REPOSITORY],
})
export class InventoryModule {}