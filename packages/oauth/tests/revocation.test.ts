import { describe, expect, it, beforeEach } from 'vitest';
import { revoke, isRevoked, type MinimalRedisClient } from '../src/revocation.js';

/**
 * T020 — Redis revocation set helpers via an in-memory FakeRedis. Same
 * pattern as apps/api/tests/unit/cli-login-routes.test.ts.
 */

class FakeRedis implements MinimalRedisClient {
  private store = new Map<string, { value: string; expiresAt: number }>();
  now = Date.now();

  async set(key: string, value: string, _mode: 'EX', ttl: number): Promise<'OK'> {
    this.store.set(key, { value, expiresAt: this.now + ttl * 1000 });
    return 'OK';
  }

  async exists(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return 0;
    if (this.now > entry.expiresAt) {
      this.store.delete(key);
      return 0;
    }
    return 1;
  }

  reset(): void {
    this.store.clear();
    this.now = Date.now();
  }
}

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
});

describe('revoke + isRevoked', () => {
  it('isRevoked returns true after revoke', async () => {
    expect(await isRevoked(redis, 'jti-1')).toBe(false);
    await revoke(redis, 'jti-1', 3600);
    expect(await isRevoked(redis, 'jti-1')).toBe(true);
  });

  it('different jtis are independent', async () => {
    await revoke(redis, 'jti-a', 3600);
    expect(await isRevoked(redis, 'jti-a')).toBe(true);
    expect(await isRevoked(redis, 'jti-b')).toBe(false);
    expect(await isRevoked(redis, 'jti-c')).toBe(false);
  });

  it('TTL expiry: isRevoked returns false after advancing past the TTL', async () => {
    await revoke(redis, 'jti-1', 10);
    expect(await isRevoked(redis, 'jti-1')).toBe(true);
    redis.now += 11_000; // advance 11s
    expect(await isRevoked(redis, 'jti-1')).toBe(false);
  });

  it('uses key prefix supastack:oauth:revoked:', async () => {
    await revoke(redis, 'jti-x', 60);
    // Reach into the fake to verify the prefix was applied
    const innerStore = (redis as unknown as { store: Map<string, unknown> }).store;
    expect([...innerStore.keys()]).toEqual(['supastack:oauth:revoked:jti-x']);
  });

  it('clamps sub-1-second TTL to 1', async () => {
    await revoke(redis, 'jti-tiny', 0);
    expect(await isRevoked(redis, 'jti-tiny')).toBe(true);
    redis.now += 2_000;
    expect(await isRevoked(redis, 'jti-tiny')).toBe(false);
  });

  it('concurrent revoke + check is still correct', async () => {
    await Promise.all([
      revoke(redis, 'jti-1', 3600),
      revoke(redis, 'jti-2', 3600),
      revoke(redis, 'jti-3', 3600),
    ]);
    const [a, b, c] = await Promise.all([
      isRevoked(redis, 'jti-1'),
      isRevoked(redis, 'jti-2'),
      isRevoked(redis, 'jti-3'),
    ]);
    expect([a, b, c]).toEqual([true, true, true]);
  });
});
