import { Controller, Get, Header } from '@nestjs/common';
import { TelemetryService } from './telemetry.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly telemetry: TelemetryService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async getMetrics(): Promise<string> {
    return this.telemetry.getMetricsSnapshot();
  }
}