/**
 * Unit tests for the Redis-backed OAuth auth-session store (feature 115, T005).
 * Mocks ioredis with an in-memory map supporting set/get/getdel.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// In-memory fake Redis backing store + a spy on SET to assert EX/NX args.
const store = new Map<string, string>();
const setSpy = vi.fn();

vi.mock('ioredis', () => {
  class FakeRedis {
    async set(key: string, val: string, ...rest: unknown[]): Promise<'OK'> {
      setSpy(key, val, ...rest);
      store.set(key, val);
      return 'OK';
    }
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    }
    async getdel(key: string): Promise<string | null> {
      const v = store.has(key) ? store.get(key)! : null;
      store.delete(key);
      return v;
    }
  }
  return { Redis: FakeRedis, default: FakeRedis };
});

const { createAuthSession, getAuthSession, consumeAuthSession, AUTH_SESSION_TTL_SEC } = await import(
  '../../src/services/oauth-auth-sessions-store.js'
);

const BASE = {
  client_id: '00000000-0000-0000-0000-000000000001',
  client_name: 'Test MCP',
  client_website: 'https://claude.ai',
  client_icon: null,
  client_domain: 'localhost',
  redirect_uri: 'http://localhost:9999/callback',
  state: 'state-xyz',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256' as const,
  scopes: ['projects:read', 'projects:write'],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  store.clear();
  setSpy.mockClear();
});

describe('oauth-auth-sessions-store', () => {
  it('create → get returns the same payload + a v4 auth_id (happy)', async () => {
    const id = await createAuthSession(BASE);
    expect(id).toMatch(UUID_RE);
    const s = await getAuthSession(id);
    expect(s).toMatchObject({ ...BASE, auth_id: id });
    expect(s?.created_at).toBeTruthy();
    expect(s?.expires_at).toBeTruthy();
  });

  it('createAuthSession issues SET … EX 600 NX (happy)', async () => {
    const id = await createAuthSession(BASE);
    expect(setSpy).toHaveBeenCalledWith(
      `oauth:auth_session:${id}`,
      expect.any(String),
      'EX',
      AUTH_SESSION_TTL_SEC,
      'NX',
    );
    expect(AUTH_SESSION_TTL_SEC).toBe(600);
  });

  it('consume returns the payload, then a subsequent get → null (happy)', async () => {
    const id = await createAuthSession(BASE);
    const consumed = await consumeAuthSession(id);
    expect(consumed?.auth_id).toBe(id);
    expect(await getAuthSession(id)).toBeNull();
  });

  it('consume on an already-consumed key → null (sad — replay protection)', async () => {
    const id = await createAuthSession(BASE);
    await consumeAuthSession(id);
    expect(await consumeAuthSession(id)).toBeNull();
  });

  it('get on a missing/expired key → null (sad)', async () => {
    expect(await getAuthSession('does-not-exist')).toBeNull();
  });

  it('malformed JSON → null, no throw (sad)', async () => {
    store.set('oauth:auth_session:bad', '{not valid json');
    expect(await getAuthSession('bad')).toBeNull();
  });
});
