import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { redisKeys } from './redis.keys';

@Injectable()
export class NonceCacheService {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  async isNonceUsed(
    eventId: string,
    ticketId: string,
    nonce: string,
  ): Promise<boolean> {
    const key = redisKeys.qrNonce(eventId, ticketId, nonce);
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async markNonceUsed(
    eventId: string,
    ticketId: string,
    nonce: string,
    ttlSeconds: number,
  ): Promise<void> {
    const key = redisKeys.qrNonce(eventId, ticketId, nonce);
    await this.redis.set(key, '1', 'EX', ttlSeconds);
  }

  async consumeNonceAtomically(
    eventId: string,
    ticketId: string,
    nonce: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    try {
      const key = redisKeys.qrNonce(eventId, ticketId, nonce);
      const result = await this.redis.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch (error) {
      throw new Error(
        `Nonce replay protection unavailable: ${(error as Error).message}`,
      );
    }
  }
}
