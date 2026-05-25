import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  putSession,
  sessionExists,
  getAndConsume,
  setRedisForTesting,
  type SessionPayload,
} from '../../src/services/cli-login-store.js';

/**
 * T007: Redis store wrapper tests using an in-memory fake.
 *
 * We use a small hand-rolled fake instead of ioredis-mock to avoid adding a
 * dep just for tests. It supports the exact subset we use: get/set with
 * EX/exists/del + TTL semantics with manual fast-forward.
 */

class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();
  now = 0;

  async set(k: string, v: string, ex: 'EX', ttlSec: number): Promise<'OK'> {
    void ex;
    this.store.set(k, { value: v, expiresAt: this.now + ttlSec * 1000 });
    return 'OK';
  }
  async get(k: string): Promise<string | null> {
    const e = this.store.get(k);
    if (!e) return null;
    if (this.now > e.expiresAt) {
      this.store.delete(k);
      return null;
    }
    return e.value;
  }
  async exists(k: string): Promise<number> {
    return (await this.get(k)) !== null ? 1 : 0;
  }
  async del(k: string): Promise<number> {
    return this.store.delete(k) ? 1 : 0;
  }
  async ttl(k: string): Promise<number> {
    const e = this.store.get(k);
    if (!e) return -2;
    return Math.max(0, Math.floor((e.expiresAt - this.now) / 1000));
  }
}

let fake: FakeRedis;

beforeEach(() => {
  fake = new FakeRedis();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setRedisForTesting(fake as any);
});

const SESSION_ID = '21f7bcf6-d8a6-43a0-b9d7-74f568073cf5';
const PAYLOAD: SessionPayload = {
  device_code: '91cbae4c',
  access_token: 'deadbeef',
  public_key: '04' + 'aa'.repeat(64),
  nonce: 'bb'.repeat(12),
  created_at: '2026-05-25T13:30:00.000Z',
  user_id: '00000000-0000-0000-0000-000000000001',
};

describe('cli-login-store', () => {
  it('putSession writes the key with TTL ≤ 300', async () => {
    await putSession(SESSION_ID, PAYLOAD);
    expect(await fake.exists(`selfbase:cli-login:${SESSION_ID}`)).toBe(1);
    expect(await fake.ttl(`selfbase:cli-login:${SESSION_ID}`)).toBeLessThanOrEqual(300);
    expect(await fake.ttl(`selfbase:cli-login:${SESSION_ID}`)).toBeGreaterThan(290);
  });

  it('getAndConsume with matching device_code returns payload + deletes key (single-use)', async () => {
    await putSession(SESSION_ID, PAYLOAD);
    const got = await getAndConsume(SESSION_ID, '91cbae4c');
    expect(got).toEqual(PAYLOAD);
    expect(await fake.exists(`selfbase:cli-login:${SESSION_ID}`)).toBe(0);
  });

  it('getAndConsume with mismatching device_code returns null and KEEPS the key', async () => {
    await putSession(SESSION_ID, PAYLOAD);
    const got = await getAndConsume(SESSION_ID, 'deadbeef');
    expect(got).toBeNull();
    expect(await fake.exists(`selfbase:cli-login:${SESSION_ID}`)).toBe(1);
  });

  it('getAndConsume on missing key returns null', async () => {
    const got = await getAndConsume(SESSION_ID, '91cbae4c');
    expect(got).toBeNull();
  });

  it('sessionExists returns true after putSession, false after getAndConsume', async () => {
    expect(await sessionExists(SESSION_ID)).toBe(false);
    await putSession(SESSION_ID, PAYLOAD);
    expect(await sessionExists(SESSION_ID)).toBe(true);
    await getAndConsume(SESSION_ID, '91cbae4c');
    expect(await sessionExists(SESSION_ID)).toBe(false);
  });

  it('TTL-expired key returns null via getAndConsume', async () => {
    await putSession(SESSION_ID, PAYLOAD);
    fake.now += 301_000; // fast-forward past the 300s TTL
    const got = await getAndConsume(SESSION_ID, '91cbae4c');
    expect(got).toBeNull();
  });

  it('corrupt JSON payload is treated as miss (returns null, does NOT throw)', async () => {
    await fake.set(`selfbase:cli-login:${SESSION_ID}`, '{not json', 'EX', 300);
    const got = await getAndConsume(SESSION_ID, '91cbae4c');
    expect(got).toBeNull();
  });
});
