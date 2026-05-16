import { Injectable } from '@nestjs/common';
import { HealthBuildMetadata } from '../health.types';

@Injectable()
export class BuildMetadataService {
  getBuildMetadata(): HealthBuildMetadata {
    return {
      version: this.safeValue(process.env.APP_VERSION, 80),
      commit: this.safeValue(process.env.APP_COMMIT, 80),
      environment: this.safeValue(process.env.NODE_ENV, 40),
    };
  }

  private safeValue(value: string | undefined, maxLength: number): string {
    const trimmed = value?.trim();

    if (!trimmed) {
      return 'unknown';
    }

    return trimmed.slice(0, maxLength);
  }
}