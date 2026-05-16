import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject('REDIS_CLIENT')
    private readonly client: Redis,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    if (this.client.status === 'wait') {
      await this.client.connect();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client.status === 'end') {
      return;
    }

    await this.client.quit();
  }

  async checkHealth(): Promise<'UP'> {
    const response = await this.client.ping();

    if (response !== 'PONG') {
      throw new Error('Redis health check failed');
    }

    return 'UP';
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
      return;
    }

    await this.client.set(key, value);
  }

  async setIfNotExists(
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<boolean> {
    if (ttlSeconds) {
      const result = await this.client.set(key, value, 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    }

    const result = await this.client.set(key, value, 'NX');
    return result === 'OK';
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async increment(key: string): Promise<number> {
    return this.client.incr(key);
  }

  async ping(): Promise<'PONG'> {
    const response = await this.client.ping();

    if (response !== 'PONG') {
      throw new Error('Unexpected Redis ping response');
    }

    return 'PONG';
  }
}