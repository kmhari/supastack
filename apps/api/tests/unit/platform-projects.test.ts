/**
 * Black-box tests for project detail routes (US4 — feature 113)
 *
 *   GET   /platform/projects/:ref
 *   PATCH /platform/projects/:ref
 *   GET   /platform/projects/:ref/databases
 *
 * Uses the same db() fluent-chain mock pattern as platform-project-settings.test.ts.
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

// Configurable result for select().from().innerJoin().where().limit()
let instRows: unknown[] = [];

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => instRows,
            offset: async () => instRows,
          }),
        }),
        where: () => ({
          limit: async () => instRows,
          offset: async () => instRows,
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
  schema: {
    supabaseInstances: {},
    organizationMembers: {},
    organizations: {},
    apiTokens: {},
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

const REF = 'ref123456789012';
const FAKE_INST = {
  ref: REF,
  name: 'Test Project',
  status: 'running',
  portKong: 54321,
  insertedAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  orgId: 'org123',
};

describe('GET /platform/projects/:ref', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    instRows = [];
    process.env.SUPASTACK_APEX = 'supaviser.dev';
    app = await buildApp();
  });

  it('200 — returns project with ref, name, status', async () => {
    instRows = [FAKE_INST];
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ref).toBe(REF);
    expect(body.name).toBe('Test Project');
    expect(body).toHaveProperty('status');
    await app.close();
  });

  it('404 — project not found', async () => {
    instRows = [];
    const res = await app.inject({ method: 'GET', url: '/platform/projects/doesnotexist' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({ method: 'GET', url: `/platform/projects/${REF}` });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });
});

describe('PATCH /platform/projects/:ref', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    instRows = [];
    process.env.SUPASTACK_APEX = 'supaviser.dev';
    app = await buildApp();
  });

  it('200 — updates name and returns updated project', async () => {
    instRows = [{ ref: REF, name: 'Old Name' }];
    const res = await app.inject({
      method: 'PATCH',
      url: `/platform/projects/${REF}`,
      headers: { 'content-type': 'application/json' },
      payload: { name: 'New Name' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe('New Name');
    expect(body.ref).toBe(REF);
    await app.close();
  });

  it('200 — empty body is a no-op (keeps existing name)', async () => {
    instRows = [{ ref: REF, name: 'Original' }];
    const res = await app.inject({
      method: 'PATCH',
      url: `/platform/projects/${REF}`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Original');
    await app.close();
  });

  it('404 — project not found', async () => {
    instRows = [];
    const res = await app.inject({
      method: 'PATCH',
      url: '/platform/projects/doesnotexist',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({
      method: 'PATCH',
      url: `/platform/projects/${REF}`,
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });
});

describe('GET /platform/projects/:ref/databases', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    instRows = [];
    process.env.SUPASTACK_APEX = 'supaviser.dev';
    app = await buildApp();
  });

  it('200 — returns array with connection info fields', async () => {
    instRows = [{ ref: REF, portKong: 54321, insertedAt: new Date('2026-01-01T00:00:00.000Z') }];
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/databases` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    const db = body[0]!;
    expect(db).toHaveProperty('db_host');
    expect(db).toHaveProperty('db_port');
    expect(db).toHaveProperty('db_user');
    expect(db).toHaveProperty('db_name');
    expect(db.identifier).toBe(REF);
    await app.close();
  });

  it('200 (empty array) — project not found returns empty array', async () => {
    instRows = [];
    const res = await app.inject({ method: 'GET', url: '/platform/projects/doesnotexist/databases' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({ method: 'GET', url: `/platform/projects/${REF}/databases` });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });
});
