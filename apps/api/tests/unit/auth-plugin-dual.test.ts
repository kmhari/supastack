import { signAccessToken, type SignResult } from '@supastack/oauth';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * T022 — dual-credential auth plugin: accepts PAT + OAuth JWT.
 *
 * Mocks @supastack/db so we can simulate user resolution. Uses a FakeRedis
 * for revocation. SUPASTACK_APEX env is set for issuer/audience derivation.
 */

const APEX = 'test.example';
process.env.SUPASTACK_APEX = APEX;
process.env.SESSION_SECRET = 'x'.repeat(64);
process.env.REDIS_URL = 'redis://stub:6379';
process.env.MASTER_KEY = Buffer.from('m'.repeat(32)).toString('base64');

const ISSUER = `https://api.${APEX}`;
const AUDIENCE = `https://mcp.${APEX}/mcp`;

// User store: map user_id → { exists, email, role }
const userStore = new Map<string, { email: string; role: 'owner' | 'administrator' | 'developer' | 'read_only' }>();
userStore.set('user-active', { email: 'a@b.c', role: 'owner' });
// user-inactive: NOT in userStore → org_members join fails → reject

// PAT store
const patStore = new Map<string, { userId: string; tokenId: string }>();
patStore.set('sbp_' + 'a'.repeat(40), { userId: 'user-active', tokenId: 'tok-1' });

vi.mock('@supastack/db', () => {
  // Feature 084 rewrote the auth plugin into TWO drizzle chains:
  //   user lookup:  select(...).from(apiTokens).innerJoin(users).where().limit(1)  [PAT]
  //                 select(...).from(users).where().limit(1)                        [OAuth → {id,email}]
  //   resolveRole:  select({role}).from(organizationMembers).where()  ← AWAITED directly, NO .limit()
  // So .where() returns a thenable: awaiting it yields the role rows (resolveRole),
  // while .limit() on it yields the user-lookup row.
  const findUser = async () => {
    if (_lastLookupKind === 'pat' && _lastPatSha) {
      for (const [token, val] of patStore) {
        const { createHash } = await import('node:crypto');
        const sha = createHash('sha256').update(token, 'utf8').digest();
        if (Buffer.compare(sha, _lastPatSha) === 0) {
          const u = userStore.get(val.userId);
          return u ? { tokenId: val.tokenId, userId: val.userId, email: u.email, role: u.role } : null;
        }
      }
      return null;
    }
    if (_lastLookupKind === 'oauth' && _lastSub) {
      const u = userStore.get(_lastSub);
      return u ? { userId: _lastSub, email: u.email, role: u.role } : null;
    }
    return null;
  };
  const lookupResult = async () => {
    const u = await findUser();
    if (!u) return [];
    return _lastLookupKind === 'pat'
      ? [{ tokenId: u.tokenId, userId: u.userId, email: u.email }]
      : [{ id: u.userId, email: u.email }];
  };
  const roleRows = async () => {
    const u = await findUser();
    return u ? [{ role: u.role }] : [];
  };
  const whereable = () => ({
    limit: lookupResult,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      roleRows().then(resolve, reject),
  });
  const joinable: () => Record<string, unknown> = () => ({
    innerJoin: () => joinable(),
    where: () => whereable(),
  });
  return {
    db: () => ({
      select: () => ({
        from: () => joinable(),
      }),
      update: () => ({
        set: () => ({
          where: async () => {},
        }),
      }),
    }),
    schema: {
      apiTokens: { id: 'id', userId: 'userId', tokenSha256: 'tokenSha256', revokedAt: 'revokedAt' },
      users: { id: 'id', email: 'email' },
      organizationMembers: { userId: 'userId', role: 'role' },
    },
  };
});

// FakeRedis for revocation
const redisStore = new Map<string, string>();
vi.mock('ioredis', () => ({
  Redis: class {
    async set(k: string, v: string): Promise<'OK'> {
      redisStore.set(k, v);
      return 'OK';
    }
    async exists(k: string): Promise<number> {
      return redisStore.has(k) ? 1 : 0;
    }
    async get(): Promise<string | null> {
      return null;
    }
  },
}));

// Stub fastify-session + connect-redis to no-op
vi.mock('@fastify/session', () => ({
  default: async () => {},
}));
vi.mock('connect-redis', () => ({
  default: class {},
}));

// Cursors so the mocked db can disambiguate which auth path is querying
let _lastLookupKind: 'pat' | 'oauth' | null = null;
let _lastPatSha: Buffer | null = null;
let _lastSub: string | null = null;

// Monkey-patch the auth plugin's lookup paths: intercept the sha256 + the
// JWT verification call to record cursors. Cleanest is to intercept the
// drizzle `eq()` calls via the previous test mock — but here we just inspect
// the request headers and stamp cursors before invoking the plugin's preHandler.

const { authPlugin, sha256 } = await import('../../src/plugins/auth.js');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authPlugin);
  // Probe route
  app.get('/probe', async (req, reply) => {
    if (!req.user) return reply.status(401).send({ ok: false });
    return { ok: true, user: req.user };
  });
  return app;
}

function masterKey(): Buffer {
  return Buffer.from(process.env.MASTER_KEY!, 'base64');
}

function mintToken(
  overrides: Partial<{ sub: string; iss: string; aud: string; ttlSec: number }> = {},
): SignResult {
  return signAccessToken({
    masterKey: masterKey(),
    sub: overrides.sub ?? 'user-active',
    azp: '00000000-0000-0000-0000-000000000099',
    aud: overrides.aud ?? AUDIENCE,
    scope: 'platform',
    iss: overrides.iss ?? ISSUER,
    ttlSec: overrides.ttlSec ?? 3600,
  });
}

beforeEach(() => {
  redisStore.clear();
  _lastLookupKind = null;
  _lastPatSha = null;
  _lastSub = null;
});

describe('auth plugin — dual-credential', () => {
  it('valid PAT resolves user', async () => {
    const app = await buildApp();
    const pat = 'sbp_' + 'a'.repeat(40);
    _lastLookupKind = 'pat';
    _lastPatSha = sha256(pat);
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${pat}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe('user-active');
    expect(res.json().user.tokenId).toBe('tok-1');
  });

  it('valid OAuth JWT resolves user (no tokenId; oauthClientId+jti set)', async () => {
    const app = await buildApp();
    const { token, jti } = mintToken();
    _lastLookupKind = 'oauth';
    _lastSub = 'user-active';
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const user = res.json().user;
    expect(user.id).toBe('user-active');
    expect(user.tokenId).toBeUndefined();
    expect(user.oauthClientId).toBe('00000000-0000-0000-0000-000000000099');
    expect(user.oauthJti).toBe(jti);
  });

  it('revoked JWT (jti in Redis) → 401', async () => {
    const app = await buildApp();
    const { token, jti } = mintToken();
    // NOTE: the revocation key prefix in packages/oauth/src/revocation.ts is still
    // `selfbase:` (the selfbase→supastack rename did not reach the Redis key/channel
    // strings — also true in pg-edge-proxy.ts). Match the live code, not the rename.
    redisStore.set(`selfbase:oauth:revoked:${jti}`, '1');
    _lastLookupKind = 'oauth';
    _lastSub = 'user-active';
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('expired JWT → 401', async () => {
    const app = await buildApp();
    const { token } = mintToken({ ttlSec: -10 });
    _lastLookupKind = 'oauth';
    _lastSub = 'user-active';
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('wrong-issuer JWT → 401', async () => {
    const app = await buildApp();
    const { token } = mintToken({ iss: 'https://api.other.example' });
    _lastLookupKind = 'oauth';
    _lastSub = 'user-active';
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('wrong-audience JWT → 401', async () => {
    const app = await buildApp();
    const { token } = mintToken({ aud: 'https://other.example/mcp' });
    _lastLookupKind = 'oauth';
    _lastSub = 'user-active';
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('JWT for removed user → 401 (SC-007 / FR-010a)', async () => {
    const app = await buildApp();
    const { token } = mintToken({ sub: 'user-removed' });
    _lastLookupKind = 'oauth';
    _lastSub = 'user-removed';
    // user-removed not in userStore → org_members join returns []
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('malformed bearer → 401', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: 'Bearer not.a.jwt.at.all' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('missing bearer → 401', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/probe' });
    expect(res.statusCode).toBe(401);
  });

  it('unknown PAT → 401', async () => {
    const app = await buildApp();
    const unknown = 'sbp_' + 'f'.repeat(40);
    _lastLookupKind = 'pat';
    _lastPatSha = sha256(unknown);
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { authorization: `Bearer ${unknown}` },
    });
    expect(res.statusCode).toBe(401);
  });
});

// suppress unused-warning if randomBytes ever drops out
void randomBytes;
