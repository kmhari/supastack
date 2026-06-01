import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createECDH } from 'node:crypto';
import { cliLoginRoutes } from '../../src/routes/cli-login.js';
import { platformCliLoginRoutes } from '../../src/routes/platform-cli-login.js';
import { setRedisForTesting, type SessionPayload } from '../../src/services/cli-login-store.js';

/**
 * T008 + T009: route-level tests for both halves of the CLI device-code login.
 * Uses an in-process Fastify app + in-memory Redis fake + DB mock.
 * Covers the contracts in:
 *   - specs/011-cli-device-login/contracts/dashboard-mint-endpoint.md
 *   - specs/011-cli-device-login/contracts/polling-endpoint.md
 */

class FakeRedis {
  private store = new Map<string, { value: string; expiresAt: number }>();
  now = 0;
  async set(k: string, v: string, _ex: 'EX', ttl: number) {
    this.store.set(k, { value: v, expiresAt: this.now + ttl * 1000 });
    return 'OK' as const;
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
  reset(): void {
    this.store.clear();
    this.now = 0;
  }
}

let fake: FakeRedis;
const tokenInserts: unknown[] = [];

// Mock @supastack/db so the mint route's `mintApiToken` call doesn't hit Postgres.
vi.mock('@supastack/db', () => ({
  db: () => ({
    insert: () => ({
      values: (vals: unknown) => ({
        returning: async () => {
          tokenInserts.push(vals);
          return [{ id: '00000000-0000-0000-0000-000000000099' }];
        },
      }),
    }),
  }),
  schema: { apiTokens: {} },
}));

// Generate a valid client P-256 keypair for "happy path" tests.
const clientEcdh = createECDH('prime256v1');
clientEcdh.generateKeys();
const VALID_CLIENT_PUB_HEX = clientEcdh.getPublicKey().toString('hex');
const SESSION_ID = '21f7bcf6-d8a6-43a0-b9d7-74f568073cf5';
const TOKEN_NAME = 'cli_lord@apples-MacBook-Pro.local_1779716109';

async function buildAppMint(
  authedUserId: string | null = '00000000-0000-0000-0000-000000000001',
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', (_req: unknown) => {
    if (!authedUserId) {
      const err = new Error('unauthenticated') as Error & { statusCode?: number };
      err.statusCode = 401;
      throw err;
    }
    return { id: authedUserId, email: 'test@example.com', role: 'admin' as const };
  });
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as Error & { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({
      error: { code: status === 401 ? 'unauthenticated' : 'internal', message: err.message },
    });
  });
  await app.register(cliLoginRoutes);
  await app.ready();
  return app;
}

async function buildAppPoll(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(platformCliLoginRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  fake = new FakeRedis();

  setRedisForTesting(fake as any);
  tokenInserts.length = 0;
});

// ─── T008: POST /api/v1/cli/login ────────────────────────────────────────────

describe('POST /api/v1/cli/login (dashboard mint)', () => {
  it('happy path: 200 + device_code shape + token insert with source=cli + Redis SET', async () => {
    const app = await buildAppMint();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: { session_id: SESSION_ID, token_name: TOKEN_NAME, public_key: VALID_CLIENT_PUB_HEX },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { device_code: string };
    expect(body.device_code).toMatch(/^[0-9a-f]{8}$/);

    expect(tokenInserts).toHaveLength(1);
    expect(tokenInserts[0]).toMatchObject({
      label: TOKEN_NAME,
      source: 'cli',
      userId: '00000000-0000-0000-0000-000000000001',
    });

    expect(await fake.exists(`selfbase:cli-login:${SESSION_ID}`)).toBe(1);
    await app.close();
  });

  it('replay: second POST with same session_id → 409 session_in_use', async () => {
    const app = await buildAppMint();
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: { session_id: SESSION_ID, token_name: TOKEN_NAME, public_key: VALID_CLIENT_PUB_HEX },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: { session_id: SESSION_ID, token_name: TOKEN_NAME, public_key: VALID_CLIENT_PUB_HEX },
    });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe('session_in_use');
    await app.close();
  });

  it('malformed session_id → 422 invalid_params', async () => {
    const app = await buildAppMint();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: {
        session_id: 'not-a-uuid',
        token_name: TOKEN_NAME,
        public_key: VALID_CLIENT_PUB_HEX,
      },
    });
    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('invalid_params');
    expect(body.error.details.field).toBe('session_id');
    await app.close();
  });

  it('malformed public_key (wrong length) → 422', async () => {
    const app = await buildAppMint();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: { session_id: SESSION_ID, token_name: TOKEN_NAME, public_key: '04abc' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.details.field).toBe('public_key');
    await app.close();
  });

  it('not-on-curve public_key → 422 (curve check via Node)', async () => {
    const app = await buildAppMint();
    const bogus = '04' + 'aa'.repeat(64); // valid length+format but not a real curve point
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: { session_id: SESSION_ID, token_name: TOKEN_NAME, public_key: bogus },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.details.field).toBe('public_key');
    await app.close();
  });

  it('no session (requireAuth throws) → 401', async () => {
    const app = await buildAppMint(null);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/cli/login',
      payload: { session_id: SESSION_ID, token_name: TOKEN_NAME, public_key: VALID_CLIENT_PUB_HEX },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ─── T009: GET /platform/cli/login/:session_id ───────────────────────────────

async function seedRedis(): Promise<SessionPayload> {
  const payload: SessionPayload = {
    device_code: '91cbae4c',
    access_token: 'deadbeef'.repeat(7),
    public_key: '04' + 'ab'.repeat(64),
    nonce: 'cc'.repeat(12),
    created_at: '2026-05-25T13:30:00.000Z',
    user_id: '00000000-0000-0000-0000-000000000001',
  };
  await fake.set(`selfbase:cli-login:${SESSION_ID}`, JSON.stringify(payload), 'EX', 300);
  return payload;
}

describe('GET /platform/cli/login/:session_id (CLI poll)', () => {
  it('happy path: matching device_code → 200 with wire-shape body + Redis key DELETED', async () => {
    const payload = await seedRedis();
    const app = await buildAppPoll();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/cli/login/${SESSION_ID}?device_code=${payload.device_code}`,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({
      id: SESSION_ID,
      created_at: payload.created_at,
      access_token: payload.access_token,
      public_key: payload.public_key,
      nonce: payload.nonce,
    });
    expect(await fake.exists(`selfbase:cli-login:${SESSION_ID}`)).toBe(0); // single-use
    await app.close();
  });

  it('SC-007 indistinguishable 404s: all 5 failure modes produce byte-identical bodies', async () => {
    await seedRedis();
    const app = await buildAppPoll();

    const cases = [
      {
        url: `/platform/cli/login/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa?device_code=91cbae4c`,
        desc: 'unknown session_id',
      },
      { url: `/platform/cli/login/not-a-uuid?device_code=91cbae4c`, desc: 'malformed session_id' },
      {
        url: `/platform/cli/login/${SESSION_ID}?device_code=ZZZZZZZZ`,
        desc: 'malformed device_code',
      },
      { url: `/platform/cli/login/${SESSION_ID}?device_code=deadbeef`, desc: 'wrong device_code' },
    ];

    const bodies = new Set<string>();
    for (const c of cases) {
      const r = await app.inject({ method: 'GET', url: c.url });
      expect(r.statusCode, `${c.desc}: should be 404`).toBe(404);
      bodies.add(r.body);
    }
    expect(bodies.size, 'all 404 bodies should be byte-identical').toBe(1);
    expect([...bodies][0]).toBe(JSON.stringify({ message: 'session not found' }));
    await app.close();
  });

  it('single-use: GET twice → first 200, second 404', async () => {
    const payload = await seedRedis();
    const app = await buildAppPoll();
    const r1 = await app.inject({
      method: 'GET',
      url: `/platform/cli/login/${SESSION_ID}?device_code=${payload.device_code}`,
    });
    expect(r1.statusCode).toBe(200);
    const r2 = await app.inject({
      method: 'GET',
      url: `/platform/cli/login/${SESSION_ID}?device_code=${payload.device_code}`,
    });
    expect(r2.statusCode).toBe(404);
    expect(r2.body).toBe(JSON.stringify({ message: 'session not found' }));
    await app.close();
  });

  it('TTL-expired session → 404', async () => {
    const payload = await seedRedis();
    fake.now += 301_000; // fast-forward
    const app = await buildAppPoll();
    const r = await app.inject({
      method: 'GET',
      url: `/platform/cli/login/${SESSION_ID}?device_code=${payload.device_code}`,
    });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it('no auth headers needed — endpoint is anonymous', async () => {
    const payload = await seedRedis();
    const app = await buildAppPoll();
    const r = await app.inject({
      method: 'GET',
      url: `/platform/cli/login/${SESSION_ID}?device_code=${payload.device_code}`,
      // No Authorization, no Cookie
    });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
