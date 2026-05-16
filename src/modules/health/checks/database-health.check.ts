import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { RequiredHealthDependencyResult } from '../health.types';

@Injectable()
export class DatabaseHealthCheck {
  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<RequiredHealthDependencyResult> {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'ok',
        required: true,
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      return {
        status: 'fail',
        required: true,
        latencyMs: Date.now() - startedAt,
      };
    }
  }
}