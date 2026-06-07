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

// Queue-based DB mock: supports both .limit() (returns Promise) and direct await (thenable chain)
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
      backups: { seq: {}, startedAt: {}, completedAt: {}, sizeBytes: {}, instanceRef: {}, status: {} },
      supabaseInstances: { ref: {}, status: {}, orgId: {}, updatedAt: {} },
      organizations: { id: {}, slug: {} },
      organizationMembers: { organizationId: {}, userId: {} },
      auditLog: { id: {}, action: {}, actorUserId: {}, targetKind: {}, targetId: {}, payload: {}, createdAt: {} },
      users: { id: {}, email: {} },
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

// per-instance-pg mock: supports lint queries and InstanceNotRunningError
const pgH = vi.hoisted(() => ({
  queryRows: [] as unknown[],
  reject: null as Error | null,
}));

const { InstanceNotRunningError: MockInstanceNotRunningError } = vi.hoisted(() => ({
  InstanceNotRunningError: class InstanceNotRunningError extends Error {
    constructor() { super('Project is not running'); }
  },
}));

vi.mock('../../src/services/per-instance-pg.js', () => ({
  withPerInstancePg: async (_ref: string, fn: (pg: { query: (sql: string) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => {
    if (pgH.reject) throw pgH.reject;
    return fn({ query: async (_sql: string) => ({ rows: pgH.queryRows }) });
  },
  InstanceNotRunningError: MockInstanceNotRunningError,
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

const REF = 'abcdefghijklmnopqrst';

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

  // Stub /v1 routes for delegation testing
  app.post('/v1/projects/:ref/restore', async (_req, reply) => {
    reply.send({ id: REF, status: 'COMING_UP', name: 'test' });
  });
  app.get('/v1/projects/:ref/network-bans', async (_req, reply) => {
    reply.send({ banned_ipv4_addresses: [] });
  });
  app.delete('/v1/projects/:ref/network-bans', async (_req, reply) => {
    reply.status(204).send();
  });
  app.get('/v1/projects/:ref/network-restrictions', async (_req, reply) => {
    reply.send({ entitlement: 'disallowed', config: { dbAllowedCidrs: [] } });
  });
  app.post('/v1/projects/:ref/network-restrictions/apply', async (_req, reply) => {
    reply.send({ ok: true });
  });
  app.get('/v1/projects/:ref/ssl-enforcement', async (_req, reply) => {
    reply.send({ currentConfig: { database: false }, appliedSuccessfully: true });
  });
  app.put('/v1/projects/:ref/ssl-enforcement', async (_req, reply) => {
    reply.send({ currentConfig: { database: true }, appliedSuccessfully: true });
  });
  app.get('/v1/projects/:ref/secrets', async (_req, reply) => {
    reply.send([]);
  });
  app.post('/v1/projects/:ref/secrets', async (_req, reply) => {
    reply.status(201).send({ message: 'All secrets stored' });
  });

  await app.register(platformMiscRoutes);
  return app;
}

beforeEach(() => {
  h.dbQueue = [];
  h.dbReject = null;
  pgH.queryRows = [];
  pgH.reject = null;
});

// ── US1: Status Endpoints ─────────────────────────────────────────────────────

describe('GET /platform/projects/:ref/pause/status', () => {
  it('paused project → initiated_at populated, status not_pausing', async () => {
    h.dbQueue = [[{ status: 'paused', updatedAt: new Date('2026-06-07T10:00:00.000Z') }]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/pause/status` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { initiated_at: string; status: string };
    expect(body.status).toBe('not_pausing');
    expect(body.initiated_at).toBe('2026-06-07T10:00:00.000Z');
    await app.close();
  });

  it('running project → initiated_at null, status not_pausing', async () => {
    h.dbQueue = [[{ status: 'running', updatedAt: new Date() }]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/pause/status` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { initiated_at: null; status: string };
    expect(body.status).toBe('not_pausing');
    expect(body.initiated_at).toBeNull();
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/pause/status` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('unknown ref (empty result) → 404', async () => {
    h.dbQueue = [[]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/pause/status` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /platform/projects/:ref/readonly', () => {
  it('paused project → {enabled: true}', async () => {
    h.dbQueue = [[{ status: 'paused' }]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/readonly` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true });
    await app.close();
  });

  it('running project → {enabled: false}', async () => {
    h.dbQueue = [[{ status: 'running' }]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/readonly` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/readonly` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('unknown ref → 404', async () => {
    h.dbQueue = [[]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/readonly` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /platform/projects/:ref/readonly', () => {
  it('delegates to POST /v1/projects/:ref/restore → returns upstream 200 + body', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/platform/projects/${REF}/readonly`, headers: { authorization: 'Bearer test-pat' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; status: string };
    expect(body.status).toBe('COMING_UP');
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'DELETE', url: `/platform/projects/${REF}/readonly`, headers: { authorization: 'Bearer test-pat' } });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /platform/projects/:ref/upgrade/status', () => {
  it('restoring project → {status: "upgrading"}', async () => {
    h.dbQueue = [[{ status: 'restoring' }]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/upgrade/status` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'upgrading' });
    await app.close();
  });

  it('running project → {status: "not_upgrading"}', async () => {
    h.dbQueue = [[{ status: 'running' }]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/upgrade/status` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'not_upgrading' });
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/upgrade/status` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('unknown ref → 404', async () => {
    h.dbQueue = [[]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/upgrade/status` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

// ── US2: Audit Log and Activity ───────────────────────────────────────────────

describe('GET /platform/projects/:ref/audit', () => {
  it('audit events exist → 200 {result:[...], count:1}', async () => {
    const auditRow = {
      id: 42,
      action: 'instance.pause',
      actorUserId: 'u1',
      actorEmail: 'admin@example.com',
      targetKind: 'instance',
      targetId: REF,
      payload: {},
      createdAt: new Date('2026-06-07T10:00:00.000Z'),
    };
    // Queue: [instCheck], [auditRows], [countRow]
    h.dbQueue = [[{ ref: REF }], [auditRow], [{ count: 1 }]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/audit` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { result: unknown[]; count: number };
    expect(body.count).toBe(1);
    expect(body.result).toHaveLength(1);
    const row = body.result[0] as Record<string, unknown>;
    expect(row.id).toBe('42');
    expect(row.action).toBe('instance.pause');
    expect(row.actor_email).toBe('admin@example.com');
    expect(row.created_at).toBe('2026-06-07T10:00:00.000Z');
    await app.close();
  });

  it('no events → {result:[], count:0}', async () => {
    h.dbQueue = [[{ ref: REF }], [], [{ count: 0 }]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/audit` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: [], count: 0 });
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/audit` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('unknown ref → 404', async () => {
    h.dbQueue = [[]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/audit` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /platform/projects/:ref/activity', () => {
  it('activity events exist → raw array ordered asc', async () => {
    const activityRow = {
      id: 1,
      action: 'instance.create',
      actorUserId: 'u1',
      actorEmail: 'admin@example.com',
      targetKind: 'instance',
      targetId: REF,
      payload: {},
      createdAt: new Date('2026-06-07T10:00:00.000Z'),
    };
    // Queue: [instCheck], [activityRows]
    h.dbQueue = [[{ ref: REF }], [activityRow]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/activity` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    const row = body[0] as Record<string, unknown>;
    expect(row.id).toBe('1');
    expect(row.action).toBe('instance.create');
    await app.close();
  });

  it('no events → []', async () => {
    h.dbQueue = [[{ ref: REF }], []];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/activity` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/activity` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── US3: Downloadable Backups ─────────────────────────────────────────────────

describe('GET /platform/database/:ref/backups/downloadable-backups', () => {
  it('backups exist → 200 {backups:[{id:1, status:"COMPLETED",...}]}', async () => {
    const startedAt = new Date('2026-06-07T02:00:00.000Z');
    const completedAt = new Date('2026-06-07T02:05:00.000Z');
    h.dbQueue = [[{ seq: 1n, startedAt, completedAt, sizeBytes: 1048576n }]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/database/${REF}/backups/downloadable-backups` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { backups: unknown[] };
    expect(body.backups).toHaveLength(1);
    const b = body.backups[0] as Record<string, unknown>;
    expect(b.id).toBe(1);
    expect(b.status).toBe('COMPLETED');
    expect(b.isPhysicalBackup).toBe(true);
    expect(b.inserted_at).toBe('2026-06-07T02:00:00.000Z');
    expect(b.completed_at).toBe('2026-06-07T02:05:00.000Z');
    expect(b.size_bytes).toBe(1048576);
    await app.close();
  });

  it('no completed backups → {backups:[]}', async () => {
    h.dbQueue = [[]];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/database/${REF}/backups/downloadable-backups` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ backups: [] });
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/database/${REF}/backups/downloadable-backups` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── US4: Delegation Endpoints ─────────────────────────────────────────────────

describe('GET /platform/projects/:ref/network-bans', () => {
  it('delegates to /v1 → returns upstream body', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/network-bans` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ banned_ipv4_addresses: [] });
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/network-bans` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('DELETE /platform/projects/:ref/network-bans', () => {
  it('delegates to /v1 → returns upstream 204', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `/platform/projects/${REF}/network-bans` });
    expect(res.statusCode).toBe(204);
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'DELETE', url: `/platform/projects/${REF}/network-bans` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /platform/projects/:ref/network-restrictions', () => {
  it('delegates to /v1 → returns upstream body', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/network-restrictions` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { entitlement: string };
    expect(body.entitlement).toBe('disallowed');
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/network-restrictions` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /platform/projects/:ref/network-restrictions/apply', () => {
  it('delegates to /v1 → returns upstream body', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/platform/projects/${REF}/network-restrictions/apply`, body: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'POST', url: `/platform/projects/${REF}/network-restrictions/apply`, body: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /platform/projects/:ref/ssl-enforcement', () => {
  it('delegates to /v1 → returns upstream body', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/ssl-enforcement` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ currentConfig: { database: false }, appliedSuccessfully: true });
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/ssl-enforcement` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('PUT /platform/projects/:ref/ssl-enforcement', () => {
  it('delegates to /v1 → returns updated config', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PUT', url: `/platform/projects/${REF}/ssl-enforcement`, body: { requestedConfig: { database: true } } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { currentConfig: { database: boolean } };
    expect(body.currentConfig.database).toBe(true);
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'PUT', url: `/platform/projects/${REF}/ssl-enforcement`, body: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /platform/projects/:ref/functions/secrets', () => {
  it('delegates to /v1 → returns []', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/functions/secrets` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/functions/secrets` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /platform/projects/:ref/functions/secrets', () => {
  it('delegates to /v1 → returns 201', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/platform/projects/${REF}/functions/secrets`, body: [{ name: 'MY_SECRET', value: 's3cr3t' }] });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ message: 'All secrets stored' });
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'POST', url: `/platform/projects/${REF}/functions/secrets`, body: [] });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── US7: Lint Queries ─────────────────────────────────────────────────────────

describe('GET /platform/projects/:ref/run-lints', () => {
  it('running project with no_rls findings → returns lint array', async () => {
    pgH.queryRows = [{ schemaname: 'public', tablename: 'my_table' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/run-lints` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string; level: string; metadata: Record<string, unknown> }>;
    expect(Array.isArray(body)).toBe(true);
    const noRls = body.find((r) => r.name === 'no_rls');
    expect(noRls).toBeDefined();
    expect(noRls?.level).toBe('WARN');
    expect(noRls?.metadata.table).toBe('my_table');
    await app.close();
  });

  it('all checks pass → []', async () => {
    pgH.queryRows = [];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/run-lints` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('project not running → 503 {code:"project_not_running"}', async () => {
    pgH.reject = new MockInstanceNotRunningError();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/run-lints` });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { code: string; error: string };
    expect(body.code).toBe('project_not_running');
    expect(body.error).toBe('Project is not running');
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/run-lints` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /platform/projects/:ref/run-lints/:name', () => {
  it('happy path → filtered results for named check', async () => {
    pgH.queryRows = [{ schemaname: 'public', tablename: 'items' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/run-lints/no_rls` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body.every((r) => r.name === 'no_rls')).toBe(true);
    await app.close();
  });

  it('unknown check name → []', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/run-lints/nonexistent_check` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });
});
