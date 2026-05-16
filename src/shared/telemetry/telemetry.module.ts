import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ContextModule } from '../context/context.module';
import { MetricsController } from './metrics.controller';
import { TelemetryService } from './telemetry.service';
import { TimingInterceptor } from './timing.interceptor';

@Global()
@Module({
  imports: [ConfigModule, ContextModule],
  controllers: [MetricsController],
  providers: [TelemetryService, TimingInterceptor],
  exports: [TelemetryService, TimingInterceptor],
})
export class TelemetryModule {}