import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
  inArray: () => ({}),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._vals: unknown[]) => ({ _sql: strings.join('?') }),
    { raw: (s: string) => s },
  ),
}));

// DB mock for platform-misc handlers that query instances
const h = vi.hoisted(() => ({
  dbQueue: [] as unknown[][],
  dbReject: null as Error | null,
}));

vi.mock('@supastack/db', () => {
  const res = () =>
    h.dbReject ? Promise.reject(h.dbReject) : Promise.resolve(h.dbQueue.shift() ?? []);
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    offset: () => res(),
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      res().then(resolve, reject),
  };
  return {
    db: () => ({ select: () => chain }),
    schema: {
      supabaseInstances: { ref: {}, status: {}, orgId: {}, updatedAt: {}, portKong: {}, encryptedSecrets: {} },
      organizations: { id: {}, slug: {} },
      organizationMembers: { organizationId: {}, userId: {} },
    },
  };
});

vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  encryptJson: () => Buffer.alloc(0),
  loadMasterKey: () => Buffer.alloc(32),
}));
vi.mock('@supastack/shared', () => ({
  ROLE_IDS: { owner: 1, administrator: 2, developer: 3, read_only: 4 },
  ROLE_NAMES: { 1: 'owner', 2: 'administrator', 3: 'developer', 4: 'read_only' },
  roleFromId: (id: number) => ({ 1: 'owner', 2: 'administrator', 3: 'developer', 4: 'read_only' }[id]),
}));
vi.mock('../../src/services/backups-mgmt-service.js', () => ({
  resolveBackupSeq: vi.fn(),
  initiateRestore: vi.fn(),
  enqueueRestore: vi.fn(),
  listBackupsForPlatform: vi.fn(),
  hashRefToInt: vi.fn().mockReturnValue(12345),
  RestoreError: class RestoreError extends Error {},
}));
vi.mock('../../src/services/api-tokens.js', () => ({ mintApiToken: vi.fn() }));
vi.mock('../../src/services/org-store.js', () => ({ createOrganizationWithOwner: vi.fn() }));
vi.mock('../../src/services/org-membership.js', () => ({
  hashInviteToken: vi.fn(),
  memberRole: vi.fn(),
  newInviteToken: vi.fn(),
  ownerCount: vi.fn(),
}));
vi.mock('../../src/services/gotrue-admin.js', () => ({
  sendRecoveryEmail: vi.fn(),
  signupGotrueUser: vi.fn(),
  updateGotrueUser: vi.fn(),
}));
vi.mock('../../src/services/auth-config-case.js', () => ({
  toApiKeys: vi.fn((x) => x),
  toStudioKeys: vi.fn((x) => x),
}));
vi.mock('../../src/services/runtime-config-store.js', () => ({
  getAuthConfig: vi.fn(),
  patchAuthConfig: vi.fn(),
  crossFieldValidate: vi.fn().mockReturnValue(null),
}));
vi.mock('../../src/services/storage-buckets-proxy.js', () => ({
  listBuckets: vi.fn().mockResolvedValue([]),
  createBucket: vi.fn(),
  getBucket: vi.fn(),
  updateBucket: vi.fn(),
  deleteBucket: vi.fn(),
}));
vi.mock('../../src/services/pg-password-reset.js', () => ({
  resetPgPasswordForInstance: vi.fn(),
  InstanceNotFoundForResetError: class extends Error {},
  InstanceNotResettableError: class extends Error {},
  PerInstanceDbUnreachableError: class extends Error {},
}));
vi.mock('../../src/services/per-instance-pg.js', () => ({
  withPerInstancePg: vi.fn(),
  InstanceNotRunningError: class InstanceNotRunningError extends Error {
    constructor() { super('Project is not running'); }
  },
}));

// DB mock for api-keys tests
const projH = vi.hoisted(() => ({
  row: null as unknown,
  reject: null as Error | null,
}));

vi.mock('../../src/services/project-store.js', () => ({
  getProjectByRef: vi.fn(async () => {
    if (projH.reject) throw projH.reject;
    return projH.row;
  }),
}));

vi.mock('../../src/services/mgmt-api-mapping.js', () => ({
  instanceApiKeys: vi.fn().mockReturnValue([]),
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');
const { apiKeysRoutes } = await import('../../src/routes/management/api-keys.js');

const REF = 'abcdefghijklmnopqrst';

// Platform-misc app: stubs v1 routes so delegation can hit them in-process
async function buildApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => {
    if (!authed) throw Object.assign(new Error('unauthenticated'), { statusCode: 401 });
    return { id: 'u1', email: 'op@x.dev', role: 'owner' };
  });
  app.decorate('authorize', () => {});
  app.decorate('authorizeOrg', async () => 'owner');
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({ error: (err as Error).message });
  });

  // Stub v1 delegation targets
  app.get('/v1/projects/:ref/postgrest', async (_req, reply) => {
    reply.send({ db_schema: 'public', db_extra_search_path: 'public,extensions', max_rows: 1000, db_pool: 15 });
  });
  app.get('/v1/projects/:ref/config/database/postgres', async (_req, reply) => {
    reply.send({ effective_cache_size: '4096MB', maintenance_work_mem: '64MB', max_connections: 100, shared_buffers: '1024MB', work_mem: '16MB' });
  });
  app.patch('/v1/projects/:ref/config/database/postgres', async (req, reply) => {
    reply.send(req.body);
  });
  app.delete('/v1/projects/:ref/secrets', async (_req, reply) => {
    reply.status(200).send({ message: 'Secrets deleted' });
  });
  // Other stubs used by platform-misc at startup
  app.post('/v1/projects/:ref/restore', async (_req, reply) => { reply.send({}); });
  app.get('/v1/projects/:ref/network-bans', async (_req, reply) => { reply.send({ banned_ipv4_addresses: [] }); });
  app.delete('/v1/projects/:ref/network-bans', async (_req, reply) => { reply.status(204).send(); });
  app.get('/v1/projects/:ref/network-restrictions', async (_req, reply) => { reply.send({}); });
  app.post('/v1/projects/:ref/network-restrictions/apply', async (_req, reply) => { reply.send({}); });
  app.get('/v1/projects/:ref/ssl-enforcement', async (_req, reply) => { reply.send({}); });
  app.put('/v1/projects/:ref/ssl-enforcement', async (_req, reply) => { reply.send({}); });
  app.get('/v1/projects/:ref/secrets', async (_req, reply) => { reply.send([]); });
  app.post('/v1/projects/:ref/secrets', async (_req, reply) => { reply.status(201).send({}); });

  await app.register(platformMiscRoutes);
  return app;
}

// Api-keys app: registers the v1 management routes directly
async function buildApiKeysApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => {
    if (!authed) throw Object.assign(new Error('unauthenticated'), { statusCode: 401 });
    return { id: 'u1', email: 'op@x.dev', role: 'owner' };
  });
  app.decorate('authorize', () => {});
  app.setErrorHandler((err, _req, reply) => {
    const code = (err as { code?: string }).code;
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({ message: (err as Error).message, code: code ?? 'error' });
  });
  await app.register(apiKeysRoutes);
  return app;
}

beforeEach(() => {
  h.dbQueue = [];
  h.dbReject = null;
  projH.row = null;
  projH.reject = null;
});

// ── US1: DELETE /platform/projects/:ref/functions/secrets ─────────────────────

describe('DELETE /platform/projects/:ref/functions/secrets', () => {
  it('delegates to DELETE /v1/projects/:ref/secrets → 200', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/platform/projects/${REF}/functions/secrets`, payload: JSON.stringify({ secrets: ['MY_KEY'] }), headers: { 'content-type': 'application/json', authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { message: string };
    expect(body.message).toBe('Secrets deleted');
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'DELETE', url: `/platform/projects/${REF}/functions/secrets` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── US2: GET /platform/projects/:ref/api/rest ─────────────────────────────────

describe('GET /platform/projects/:ref/api/rest', () => {
  it('delegates to GET /v1/projects/:ref/postgrest → real config', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/api/rest`, headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { db_schema: string; max_rows: number; db_pool: number };
    expect(body.db_schema).toBe('public');
    expect(body.max_rows).toBe(1000);
    expect(body.db_pool).toBe(15);
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/api/rest` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('v1 returns 404 → propagated verbatim', async () => {
    const app = Fastify();
    app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role: 'owner' }));
    app.decorate('authorize', () => {});
    app.decorate('authorizeOrg', async () => 'owner');
    app.setErrorHandler((err, _req, reply) => {
      reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: (err as Error).message });
    });
    // Stub postgrest to return 404
    app.get('/v1/projects/:ref/postgrest', async (_req, reply) => { reply.status(404).send({ message: 'not found' }); });
    app.post('/v1/projects/:ref/restore', async (_req, reply) => { reply.send({}); });
    app.get('/v1/projects/:ref/network-bans', async (_req, reply) => { reply.send({}); });
    app.delete('/v1/projects/:ref/network-bans', async (_req, reply) => { reply.status(204).send(); });
    app.get('/v1/projects/:ref/network-restrictions', async (_req, reply) => { reply.send({}); });
    app.post('/v1/projects/:ref/network-restrictions/apply', async (_req, reply) => { reply.send({}); });
    app.get('/v1/projects/:ref/ssl-enforcement', async (_req, reply) => { reply.send({}); });
    app.put('/v1/projects/:ref/ssl-enforcement', async (_req, reply) => { reply.send({}); });
    app.get('/v1/projects/:ref/secrets', async (_req, reply) => { reply.send([]); });
    app.post('/v1/projects/:ref/secrets', async (_req, reply) => { reply.status(201).send({}); });
    app.get('/v1/projects/:ref/config/database/postgres', async (_req, reply) => { reply.send({}); });
    app.patch('/v1/projects/:ref/config/database/postgres', async (_req, reply) => { reply.send({}); });
    app.delete('/v1/projects/:ref/secrets', async (_req, reply) => { reply.send({}); });
    await app.register(platformMiscRoutes);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/api/rest`, headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ── US3: GET/PATCH /platform/projects/:ref/postgres-config ────────────────────

describe('GET /platform/projects/:ref/postgres-config', () => {
  it('delegates to GET /v1/projects/:ref/config/database/postgres → real config', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/postgres-config`, headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { max_connections: number; shared_buffers: string };
    expect(body.max_connections).toBe(100);
    expect(body.shared_buffers).toBe('1024MB');
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/postgres-config` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('PATCH /platform/projects/:ref/postgres-config', () => {
  it('delegates to PATCH /v1/projects/:ref/config/database/postgres → updated config', async () => {
    const app = await buildApp();
    const patch = { max_connections: 200, work_mem: '32MB' };
    const res = await app.inject({ method: 'PATCH', url: `/platform/projects/${REF}/postgres-config`, payload: JSON.stringify(patch), headers: { 'content-type': 'application/json', authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as typeof patch;
    expect(body.max_connections).toBe(200);
    expect(body.work_mem).toBe('32MB');
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'PATCH', url: `/platform/projects/${REF}/postgres-config`, payload: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── US4: DELETE/PATCH /v1/projects/:ref/api-keys/:id ─────────────────────────

describe('DELETE /v1/projects/:ref/api-keys/:id', () => {
  it('valid project + any id → 404 not_found (no custom keys in self-hosted)', async () => {
    projH.row = { ref: REF, encryptedSecrets: Buffer.alloc(0) };
    const app = await buildApiKeysApp();
    const res = await app.inject({ method: 'DELETE', url: `/projects/${REF}/api-keys/some-id`, headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { code: string };
    expect(body.code).toBe('not_found');
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApiKeysApp(false);
    const res = await app.inject({ method: 'DELETE', url: `/projects/${REF}/api-keys/some-id` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('unknown project ref → 404 project not_found', async () => {
    projH.row = null;
    const app = await buildApiKeysApp();
    const res = await app.inject({ method: 'DELETE', url: `/projects/${REF}/api-keys/some-id`, headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { message: string };
    expect(body.message).toMatch(/Project not found/i);
    await app.close();
  });
});

describe('PATCH /v1/projects/:ref/api-keys/:id', () => {
  it('valid project + any id → 404 not_found (no custom keys in self-hosted)', async () => {
    projH.row = { ref: REF, encryptedSecrets: Buffer.alloc(0) };
    const app = await buildApiKeysApp();
    const res = await app.inject({ method: 'PATCH', url: `/projects/${REF}/api-keys/some-id`, payload: JSON.stringify({ name: 'New name' }), headers: { 'content-type': 'application/json', authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(404);
    const body = res.json() as { code: string };
    expect(body.code).toBe('not_found');
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApiKeysApp(false);
    const res = await app.inject({ method: 'PATCH', url: `/projects/${REF}/api-keys/some-id`, payload: '{}', headers: { 'content-type': 'application/json' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
