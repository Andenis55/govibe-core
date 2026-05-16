import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '../config/config.service';
import { AdmissionCacheService } from './admission-cache.service';
import { NonceCacheService } from './nonce-cache.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const env = configService.getOrThrow('NODE_ENV');
        const appName = configService.getOrThrow('APP_NAME');

        return new Redis(configService.getOrThrow('REDIS_URL'), {
          keyPrefix: `${appName}:${env}:`,
          maxRetriesPerRequest: 2,
          enableReadyCheck: true,
          lazyConnect: false,
          retryStrategy(times: number) {
            return Math.min(times * 200, 5000);
          },
        });
      },
      inject: [ConfigService],
    },
    RedisService,
    NonceCacheService,
    AdmissionCacheService,
    {
      provide: 'NONCE_CACHE_SERVICE',
      useExisting: NonceCacheService,
    },
    {
      provide: 'ADMISSION_CACHE_SERVICE',
      useExisting: AdmissionCacheService,
    },
  ],
  exports: [
    'REDIS_CLIENT',
    RedisService,
    NonceCacheService,
    AdmissionCacheService,
    'NONCE_CACHE_SERVICE',
    'ADMISSION_CACHE_SERVICE',
  ],
})
export class RedisModule {}