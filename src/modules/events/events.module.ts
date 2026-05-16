import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';
import { OrganizersModule } from '../organizers/organizers.module';
import { EventsService } from './application/events.service';
import { EventsController } from './controllers/events.controller';
import { EVENT_REPOSITORY } from './events.tokens';
import { PrismaEventRepository } from './infrastructure/repositories/prisma-event.repository';

@Module({
  imports: [AuthModule, OrganizersModule, PrismaModule, LoggingModule, TelemetryModule],
  controllers: [EventsController],
  providers: [
    EventsService,
    {
      provide: EVENT_REPOSITORY,
      useClass: PrismaEventRepository,
    },
  ],
  exports: [EventsService, EVENT_REPOSITORY],
})
export class EventsModule {}