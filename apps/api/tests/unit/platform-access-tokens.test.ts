/**
 * Black-box tests for PAT routes — auth guards + GET single token (US4 — feature 113)
 *
 * Happy-path tests for list/create/delete are already in access-tokens.test.ts.
 * This file adds:
 *   - 401 auth guards for all four routes
 *   - GET /platform/profile/access-tokens/:id  (200 + 404 — not covered elsewhere)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
  isNull: () => ({}),
  sql: () => ({}),
}));

let selectResult: unknown[] = [];

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => selectResult,
          limit: async () => selectResult,
        }),
        innerJoin: () => ({
          where: () => ({ limit: async () => selectResult }),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
  schema: {
    apiTokens: {},
    supabaseInstances: {},
    organizationMembers: {},
    organizations: {},
    auditLog: {},
  },
}));

vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  loadMasterKey: () => Buffer.alloc(32),
  generateRef: () => 'abcdefghijklmnopqrst',
}));

vi.mock('../../src/services/api-tokens.js', () => ({
  mintApiToken: async () => ({ raw: `sbp_${'a'.repeat(40)}`, id: 'tok-new', prefix: 'sbp_aaaa' }),
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

const FAKE_TOKEN_ROW = {
  id: 'tok1',
  name: 'My Token',
  tokenAlias: 'sbp_aaaaaaaa',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  lastUsedAt: null,
};

async function buildApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );
  app.decorate('requireAuth', () => {
    if (!authed) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    return { id: 'u1', email: 'op@x.dev', role: 'owner' as const };
  });
  app.decorate('authorizeOrg', async () => 'owner' as const);
  await app.register(platformMiscRoutes);
  return app;
}

describe('/platform/profile/access-tokens — auth guards', () => {
  beforeEach(() => {
    selectResult = [];
  });

  it('GET list 401 — unauthenticated', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: '/platform/profile/access-tokens' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('POST 401 — unauthenticated', async () => {
    const app = await buildApp(false);
    const res = await app.inject({
      method: 'POST',
      url: '/platform/profile/access-tokens',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'test' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('DELETE 401 — unauthenticated', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'DELETE', url: '/platform/profile/access-tokens/tok1' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /platform/profile/access-tokens/:id', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    selectResult = [];
    app = await buildApp();
  });

  it('200 — returns single token in AccessToken shape', async () => {
    selectResult = [FAKE_TOKEN_ROW];
    const res = await app.inject({ method: 'GET', url: '/platform/profile/access-tokens/tok1' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe('tok1');
    expect(body.name).toBe('My Token');
    expect(body.token_alias).toBe('sbp_aaaaaaaa');
    expect(body.scope).toBe('V0');
    await app.close();
  });

  it('404 — token not found', async () => {
    selectResult = [];
    const res = await app.inject({ method: 'GET', url: '/platform/profile/access-tokens/unknown' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({
      method: 'GET',
      url: '/platform/profile/access-tokens/tok1',
    });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });
});
