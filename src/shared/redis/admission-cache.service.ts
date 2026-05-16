import { Inject, Injectable } from '@nestjs/common';
import { AdmissionState } from '@prisma/client';
import Redis from 'ioredis';
import { redisKeys } from './redis.keys';

@Injectable()
export class AdmissionCacheService {
  private static readonly DEFAULT_TTL_SECONDS = 300;

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async getTicketState(ticketId: string): Promise<AdmissionState | null> {
    try {
      const value = await this.redis.get(redisKeys.admissionState(ticketId));
      return value as AdmissionState | null;
    } catch {
      return null;
    }
  }

  async setTicketState(
    ticketId: string,
    state: AdmissionState,
    ttlSeconds = AdmissionCacheService.DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    try {
      await this.redis.set(
        redisKeys.admissionState(ticketId),
        state,
        'EX',
        ttlSeconds,
      );
    } catch {
      return;
    }
  }

  async isTicketRevoked(ticketId: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(redisKeys.revokedTicket(ticketId));
      return exists === 1;
    } catch {
      return false;
    }
  }

  async markTicketRevoked(
    ticketId: string,
    ttlSeconds = AdmissionCacheService.DEFAULT_TTL_SECONDS,
  ): Promise<void> {
    try {
      await this.redis.set(
        redisKeys.revokedTicket(ticketId),
        '1',
        'EX',
        ttlSeconds,
      );
    } catch {
      return;
    }
  }

  async primeAdmissionState(ticketId: string, state: AdmissionState): Promise<void> {
    await this.setTicketState(ticketId, state);
  }

  async clearTicketState(ticketId: string): Promise<void> {
    try {
      await this.redis.del(redisKeys.admissionState(ticketId));
    } catch {
      return;
    }
  }
}
