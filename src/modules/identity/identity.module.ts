import { Module } from '@nestjs/common';
import { AuthModule } from '../../shared/auth/auth.module';
import { LoggingModule } from '../../shared/logging/logging.module';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { TelemetryModule } from '../../shared/telemetry/telemetry.module';
import { AuthController } from './controllers/auth.controller';

@Module({
  imports: [AuthModule, PrismaModule, LoggingModule, TelemetryModule],
  controllers: [AuthController],
  providers: [],
  exports: [],
})
export class IdentityModule {}