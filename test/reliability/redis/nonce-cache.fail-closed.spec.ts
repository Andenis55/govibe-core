import { NonceCacheService } from '../../../src/shared/redis/nonce-cache.service';

describe('NonceCacheService fail-closed behavior', () => {
  it('surfaces infrastructure errors when Redis is unavailable', async () => {
    const redis = {
      set: jest.fn().mockRejectedValue(new Error('redis down')),
    };
    const service = new NonceCacheService(redis as never);

    await expect(
      service.consumeNonceAtomically('event-1', 'ticket-1', 'nonce-1', 60),
    ).rejects.toThrow('Nonce replay protection unavailable: redis down');
  });
});