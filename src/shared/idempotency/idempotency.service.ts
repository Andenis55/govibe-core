import { Injectable } from '@nestjs/common';

@Injectable()
export class IdempotencyService {
  hashRequest(_payload: Record<string, unknown>): string {
    return 'request-hash';
  }

  async assertRequest(_key: string, _fingerprint: string): Promise<void> {
    return Promise.resolve();
  }

  async getStoredResponse(
    _key: string,
  ): Promise<Record<string, unknown> | null> {
    return Promise.resolve(null);
  }

  async storeResponse(
    _key: string,
    _response: Record<string, unknown>,
  ): Promise<void> {
    return Promise.resolve();
  }
}