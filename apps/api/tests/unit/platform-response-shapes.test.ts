/**
 * Contract tests: verify our platform endpoint response shapes match the
 * upstream Supabase type definitions (platform.d.ts / api.d.ts).
 *
 * Each test asserts the presence of every required field Studio reads at
 * runtime. A missing field here means a crash in Studio (e.g. `.includes()`
 * on undefined `categories`, routing on missing `organization_slug`).
 */
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
      supabaseInstances: { ref: {}, name: {}, status: {}, orgId: {}, updatedAt: {}, portKong: {}, encryptedSecrets: {}, createdAt: {} },
      organizations: { id: {}, slug: {} },
      organizationMembers: { organizationId: {}, userId: {} },
    },
  };
});

vi.mock('@supastack/crypto', () => ({
  decryptJson: vi.fn(() => ({ anonKey: 'anon-jwt', serviceRoleKey: 'service-jwt' })),
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
  hashRefToInt: vi.fn().mockReturnValue(99999),
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

const lintH = vi.hoisted(() => ({ pgResult: [] as Record<string, unknown>[] }));

vi.mock('../../src/services/per-instance-pg.js', () => ({
  withPerInstancePg: vi.fn(async (_ref: string, cb: (pg: unknown) => unknown) =>
    cb({ query: async () => ({ rows: lintH.pgResult }) }),
  ),
  InstanceNotRunningError: class InstanceNotRunningError extends Error {
    constructor() { super('Project is not running'); }
  },
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

const REF = 'abcdefghijklmnopqrst';
const ORG_ID = 'orgabcdefghijklmnopq';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role: 'owner' as const }));
  app.decorate('authorize', () => {});
  app.decorate('authorizeOrg', async () => 'owner' as const);
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    reply.status(status).send({ error: (err as Error).message });
  });
  // Stub /api/v1/instances POST (used by project creation delegation)
  app.post('/api/v1/instances', async (_req, reply) => {
    reply.status(201).send({ ref: REF, name: 'Test Project', status: 'COMING_UP' });
  });
  // Stub /v1/projects/:ref/postgrest (used by platform postgrest config delegation)
  app.get('/v1/projects/:ref/postgrest', async (_req, reply) => {
    reply.send({ db_schema: 'public,graphql_public', db_extra_search_path: 'public, extensions', max_rows: 1000, db_pool: null, jwt_secret: 'test-jwt-secret' });
  });
  // Stub /v1/profile (used by platform profile delegation, feature 112)
  app.get('/v1/profile', async (_req, reply) => {
    reply.send({ id: 'user-uuid-1', primary_email: 'op@x.dev' });
  });
  // Stub /v1/projects/:ref/config/realtime (feature 112)
  app.get('/v1/projects/:ref/config/realtime', async (_req, reply) => {
    reply.send({ max_concurrent_users: 200 });
  });
  app.patch('/v1/projects/:ref/config/realtime', async (req, reply) => {
    reply.send({ ...(req.body as object), max_concurrent_users: (req.body as Record<string, unknown>).max_concurrent_users ?? 200 });
  });
  // Stub /v1/projects/:ref/config/database/pgbouncer (feature 112)
  app.get('/v1/projects/:ref/config/database/pgbouncer', async (_req, reply) => {
    reply.send({ pool_mode: 'transaction', default_pool_size: 15, ignore_startup_parameters: 'extra_float_digits', max_client_conn: 200, connection_string: '' });
  });
  app.patch('/v1/projects/:ref/config/database/pooler', async (req, reply) => {
    reply.send({ pool_mode: 'transaction', default_pool_size: 15, ignore_startup_parameters: 'extra_float_digits', max_client_conn: 200, connection_string: '', ...(req.body as object) });
  });
  await app.register(platformMiscRoutes);
  return app;
}

beforeEach(() => {
  h.dbQueue = [];
  h.dbReject = null;
  lintH.pgResult = [];
});

// ── GET /platform/projects — ListProjectsPaginatedResponse shape ─────────────

describe('GET /platform/projects — response shape', () => {
  it('each project includes organization_slug and preview_branch_refs', async () => {
    h.dbQueue.push([
      { ref: REF, name: 'P1', status: 'running', portKong: 5400, insertedAt: new Date(), updatedAt: new Date(), orgId: ORG_ID },
    ]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/platform/projects', headers: { authorization: 'Bearer tok' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { projects: Record<string, unknown>[] };
    expect(body.projects).toHaveLength(1);
    const project = body.projects[0];
    expect(project).toHaveProperty('organization_slug');
    expect(project).toHaveProperty('preview_branch_refs');
    expect(Array.isArray(project.preview_branch_refs)).toBe(true);
    await app.close();
  });

  it('pagination envelope is present', async () => {
    h.dbQueue.push([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/platform/projects', headers: { authorization: 'Bearer tok' } });
    const body = res.json() as { pagination: Record<string, unknown> };
    expect(body.pagination).toMatchObject({ count: 0, limit: expect.any(Number), offset: expect.any(Number) });
    await app.close();
  });
});

// ── POST /platform/projects — CreateProjectResponse shape ────────────────────

describe('POST /platform/projects — response shape', () => {
  it('returns all required CreateProjectResponse fields', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/platform/projects',
      payload: JSON.stringify({ name: 'Test Project', organization_slug: ORG_ID }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    // Fields required by CreateProjectResponse in platform.d.ts
    expect(typeof body.id).toBe('number');
    expect(body).toHaveProperty('ref');
    expect(body).toHaveProperty('name');
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('anon_key');
    expect(body).toHaveProperty('service_key');
    expect(body).toHaveProperty('endpoint');
    expect(body).toHaveProperty('organization_slug');
    expect(body).toHaveProperty('preview_branch_refs');
    expect(Array.isArray(body.preview_branch_refs)).toBe(true);
    expect(body).toHaveProperty('inserted_at');
    expect(body).toHaveProperty('is_branch_enabled');
    expect(body).toHaveProperty('is_physical_backups_enabled');
    await app.close();
  });

  it('id is a number (not a ref string)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/platform/projects',
      payload: JSON.stringify({ name: 'Test', organization_slug: ORG_ID }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    });
    const body = res.json() as { id: unknown };
    expect(typeof body.id).toBe('number');
    await app.close();
  });
});

// ── GET /platform/projects/:ref/databases — DatabaseDetailResponse shape ─────

describe('GET /platform/projects/:ref/databases — response shape', () => {
  it('each database entry includes db_user', async () => {
    h.dbQueue.push([{ ref: REF, portKong: 5400, insertedAt: new Date() }]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/databases`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0]).toHaveProperty('db_user', 'postgres');
    await app.close();
  });

  it('includes all other required DatabaseDetailResponse fields', async () => {
    h.dbQueue.push([{ ref: REF, portKong: 5400, insertedAt: new Date() }]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/databases`,
      headers: { authorization: 'Bearer tok' },
    });
    const [db] = res.json() as Record<string, unknown>[];
    expect(db).toHaveProperty('cloud_provider');
    expect(db).toHaveProperty('db_host');
    expect(db).toHaveProperty('db_name');
    expect(db).toHaveProperty('db_port');
    expect(db).toHaveProperty('db_user');
    expect(db).toHaveProperty('identifier');
    expect(db).toHaveProperty('inserted_at');
    expect(db).toHaveProperty('region');
    expect(db).toHaveProperty('status');
    await app.close();
  });

  it('unknown ref → empty array', async () => {
    h.dbQueue.push([]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/databases`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });
});

// ── GET /platform/projects/:ref/run-lints — GetProjectLintsResponse shape ────

describe('GET /platform/projects/:ref/run-lints — response shape', () => {
  it('each lint result includes categories array (fixes Studio .includes() crash)', async () => {
    h.dbQueue.push([{ ref: REF, portKong: 5400, insertedAt: new Date(), orgId: ORG_ID }]);
    lintH.pgResult = [{ schemaname: 'public', tablename: 'users' }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/run-lints`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    const lints = res.json() as Record<string, unknown>[];
    expect(lints.length).toBeGreaterThan(0);
    for (const lint of lints) {
      expect(Array.isArray(lint.categories)).toBe(true);
      // Studio does lint.categories.includes(category) — must not throw
      expect(() => (lint.categories as string[]).includes('SECURITY')).not.toThrow();
    }
    await app.close();
  });

  it('each lint result includes all required GetProjectLintsResponse fields', async () => {
    h.dbQueue.push([{ ref: REF, portKong: 5400, insertedAt: new Date(), orgId: ORG_ID }]);
    lintH.pgResult = [{ schemaname: 'public', tablename: 'orders' }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/run-lints`,
      headers: { authorization: 'Bearer tok' },
    });
    const [lint] = res.json() as Record<string, unknown>[];
    expect(lint).toHaveProperty('name');
    expect(lint).toHaveProperty('title');
    expect(lint).toHaveProperty('level');
    expect(lint).toHaveProperty('categories');
    expect(lint).toHaveProperty('description');
    expect(lint).toHaveProperty('detail');
    expect(lint).toHaveProperty('remediation');
    expect(lint).toHaveProperty('cache_key');
    expect(lint).toHaveProperty('facing', 'EXTERNAL');
    expect(lint).toHaveProperty('metadata');
    await app.close();
  });

  it('returns empty array when no lints fire', async () => {
    h.dbQueue.push([{ ref: REF, portKong: 5400, insertedAt: new Date(), orgId: ORG_ID }]);
    // pgResult stays [] — no rows for any check
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/run-lints`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });
});

// ── GET /platform/projects/:ref/config/postgrest — GetPostgrestConfigResponse shape ──

describe('GET /platform/projects/:ref/config/postgrest — response shape', () => {
  it('includes db_anon_role, role_claim_key, jwt_secret (platform fields missing from /v1)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/config/postgrest`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('db_anon_role', 'anon');
    expect(body).toHaveProperty('role_claim_key', '.role');
    expect(body).toHaveProperty('jwt_secret');
    expect(body).toHaveProperty('db_schema');
    expect(body).toHaveProperty('max_rows');
    await app.close();
  });
});

// ── GET /platform/profile — Profile shape (feature 112 US1) ──────────────────

describe('GET /platform/profile — response shape', () => {
  it('returns real id (UUID) from /v1/profile, not hardcoded 1', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/platform/profile',
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    // id must be the real UUID string, not the old hardcoded integer 1
    expect(body.id).toBe('user-uuid-1');
    expect(typeof body.id).toBe('string');
    await app.close();
  });

  it('includes all Studio-required profile fields', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/platform/profile',
      headers: { authorization: 'Bearer tok' },
    });
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('primary_email', 'op@x.dev');
    expect(body).toHaveProperty('username', 'op');
    expect(body).toHaveProperty('gotrue_id', 'user-uuid-1');
    expect(body).toHaveProperty('free_project_limit', 999);
    expect(Array.isArray(body.disabled_features)).toBe(true);
    expect(typeof body.is_alpha_user).toBe('boolean');
    await app.close();
  });

  it('gotrue_id equals id', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/platform/profile',
      headers: { authorization: 'Bearer tok' },
    });
    const body = res.json() as Record<string, unknown>;
    expect(body.gotrue_id).toBe(body.id);
    await app.close();
  });
});

// ── GET/PATCH /platform/projects/:ref/config/realtime — shape (feature 112 US2)

describe('GET /platform/projects/:ref/config/realtime — response shape', () => {
  it('returns max_concurrent_users (delegates to v1)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/config/realtime`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('max_concurrent_users');
    expect(typeof body.max_concurrent_users).toBe('number');
    await app.close();
  });

  it('PATCH delegates and returns updated value', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/platform/projects/${REF}/config/realtime`,
      payload: JSON.stringify({ max_concurrent_users: 500 }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('max_concurrent_users', 500);
    await app.close();
  });
});

// ── GET /platform/projects/:ref/config/pgbouncer — shape (feature 112 US3) ───

describe('GET /platform/projects/:ref/config/pgbouncer — response shape', () => {
  it('returns all required PgBouncerConfigResponse fields (delegates to v1)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/config/pgbouncer`,
      headers: { authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('pool_mode');
    expect(body).toHaveProperty('default_pool_size');
    expect(body).toHaveProperty('ignore_startup_parameters');
    expect(body).toHaveProperty('max_client_conn');
    expect(body).toHaveProperty('connection_string');
    await app.close();
  });

  it('PATCH delegates to pooler endpoint and returns updated config', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/platform/projects/${REF}/config/pgbouncer`,
      payload: JSON.stringify({ pool_mode: 'session', default_pool_size: 25 }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('pool_mode', 'session');
    expect(body).toHaveProperty('default_pool_size', 25);
    expect(body).toHaveProperty('connection_string');
    await app.close();
  });
});
