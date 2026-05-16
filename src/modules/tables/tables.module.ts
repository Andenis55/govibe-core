import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { EventsModule } from '../events/events.module';
import { OrganizersModule } from '../organizers/organizers.module';
import { TableAuditService } from './application/table-audit.service';
import { TableIdempotencyService } from './application/table-idempotency.service';
import { TableReservationsService } from './application/table-reservations.service';
import { TablesService } from './application/tables.service';
import { TablesController } from './controllers/tables.controller';
import { TableReservationsRepository } from './infrastructure/table-reservations.repository';
import { TablesRepository } from './infrastructure/tables.repository';

@Module({
  imports: [
    AuthModule,
    OrganizersModule,
    EventsModule,
    PrismaModule,
    LoggingModule,
    TelemetryModule,
  ],
  controllers: [TablesController],
  providers: [
    TablesRepository,
    TableReservationsRepository,
    TableAuditService,
    TableIdempotencyService,
    TableReservationsService,
    TablesService,
  ],
  exports: [
    TablesRepository,
    TableReservationsRepository,
    TableAuditService,
    TableIdempotencyService,
    TableReservationsService,
    TablesService,
  ],
})
export class TablesModule {}