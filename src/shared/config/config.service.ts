import { Injectable } from '@nestjs/common';
import {
  type AppConfigValues,
  validateConfig,
} from './validation.schema';

type NumericConfigKey = 'PORT' | 'JWT_ACCESS_TTL' | 'JWT_REFRESH_TTL';

@Injectable()
export class AppConfigService {
  private readonly config: AppConfigValues;

  constructor() {
    this.config = validateConfig(process.env);
  }

  get<K extends keyof AppConfigValues>(key: K): AppConfigValues[K];
  get(key: string): string | number | undefined;
  get<K extends keyof AppConfigValues>(
    key: K,
  ): AppConfigValues[K] | string | number | undefined {
    if (key in this.config) {
      return this.config[key];
    }

    return process.env[key]?.trim();
  }

  getOptional<K extends keyof AppConfigValues>(
    key: K,
  ): AppConfigValues[K] | undefined;
  getOptional(key: string): string | number | undefined;
  getOptional<K extends keyof AppConfigValues>(
    key: K,
  ): AppConfigValues[K] | undefined {
    return this.get(key) as AppConfigValues[K] | undefined;
  }

  getNumber(key: NumericConfigKey): number {
    return this.config[key];
  }

  getOrThrow<K extends keyof AppConfigValues>(key: K): AppConfigValues[K];
  getOrThrow(key: string): string;
  getOrThrow<K extends keyof AppConfigValues>(
    key: K,
  ): AppConfigValues[K] | string {
    const value = this.get(key);

    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing configuration value for ${key}`);
    }

    return value as AppConfigValues[K];
  }
}

export { AppConfigService as ConfigService };