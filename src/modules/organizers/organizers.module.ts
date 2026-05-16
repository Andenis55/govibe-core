import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';
import { OrganizersService } from './application/organizers.service';
import { OrganizersController } from './controllers/organizers.controller';
import { PrismaOrganizerRepository } from './infrastructure/repositories/prisma-organizer.repository';
import { ORGANIZER_REPOSITORY } from './organizers.tokens';

@Module({
  imports: [AuthModule, PrismaModule, LoggingModule, TelemetryModule],
  controllers: [OrganizersController],
  providers: [
    OrganizersService,
    {
      provide: ORGANIZER_REPOSITORY,
      useClass: PrismaOrganizerRepository,
    },
  ],
  exports: [OrganizersService, ORGANIZER_REPOSITORY],
})
export class OrganizersModule {}