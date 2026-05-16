import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { HealthService } from './health.service';
import {
  LivenessHealthResponse,
  ReadinessHealthResponse,
  SummaryHealthResponse,
} from './health.types';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get('live')
  @HttpCode(HttpStatus.OK)
  getLiveness(): LivenessHealthResponse {
    return this.healthService.getLiveness();
  }

  @Public()
  @Get('ready')
  async getReadiness(
    @Res({ passthrough: true }) response: Response,
  ): Promise<ReadinessHealthResponse> {
    const result = await this.healthService.getReadiness();

    if (result.status === 'not_ready') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return result;
  }

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  getSummary(): SummaryHealthResponse {
    return this.healthService.getSummary();
  }
}