import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Unit tests for three stub→real conversions in platform-misc.ts:
 *  1. GET /platform/projects/:ref/restore/versions  — real DB query on backups
 *  2. GET /platform/projects/:ref/daily-stats       — real aggregate on audit_log
 *  3. GET /platform/organizations/:slug/available-versions — static list (was [])
 */

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
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
  backupRows: [] as unknown[],
  executeRows: [] as unknown[],
}));

vi.mock('@supastack/db', () => {
  const selectObj: Record<string, unknown> = {
    from: () => selectObj,
    where: () => selectObj,
    limit: () => Promise.resolve(h.backupRows),
    orderBy: () => Promise.resolve(h.backupRows),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(h.backupRows).then(resolve),
  };
  return {
    db: () => ({
      select: () => selectObj,
      execute: () => Promise.resolve(h.executeRows),
    }),
    schema: {
      backups: {
        seq: {},
        startedAt: {},
        completedAt: {},
        sizeBytes: {},
        instanceRef: {},
        status: {},
      },
      supabaseInstances: { ref: {}, status: {}, orgId: {} },
      organizations: { id: {}, slug: {} },
      organizationMembers: { organizationId: {}, userId: {} },
    },
  };
});

vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
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

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role: 'owner' }));
  app.decorate('authorize', () => {});
  app.decorate('authorizeOrg', async () => 'owner');
  await app.register(platformMiscRoutes);
  return app;
}

const REF = 'abcdefghijklmnopqrst';
const SLUG = 'my-org';

// ── restore/versions ────────────────────────────────────────────────────────

describe('GET /platform/projects/:ref/restore/versions', () => {
  beforeEach(() => {
    h.backupRows = [];
  });

  it('returns empty array when no completed backups exist', async () => {
    h.backupRows = [];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/restore/versions` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it('returns completed backup entries with numeric id, timestamps, and isPhysicalBackup flag', async () => {
    const now = new Date('2026-06-06T14:00:00.000Z');
    const done = new Date('2026-06-06T14:00:00.155Z');
    h.backupRows = [{ seq: 6, startedAt: now, completedAt: done, sizeBytes: 1024 }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/restore/versions` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: 6,
      inserted_at: now.toISOString(),
      completed_at: done.toISOString(),
      size_bytes: 1024,
      isPhysicalBackup: true,
      status: 'COMPLETED',
    });
    await app.close();
  });

  it('handles null seq by coercing to 0', async () => {
    h.backupRows = [{ seq: null, startedAt: new Date(), completedAt: null, sizeBytes: null }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/restore/versions` });
    const body = res.json() as Array<{ id: number; completed_at: unknown; size_bytes: unknown }>;
    expect(body[0]!.id).toBe(0);
    expect(body[0]!.completed_at).toBeNull();
    expect(body[0]!.size_bytes).toBeNull();
    await app.close();
  });
});

// ── daily-stats ─────────────────────────────────────────────────────────────

describe('GET /platform/projects/:ref/daily-stats', () => {
  beforeEach(() => {
    h.executeRows = [];
  });

  it('returns {data:[]} when no audit events exist', async () => {
    h.executeRows = [];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/daily-stats` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ data: [] });
    await app.close();
  });

  it('maps aggregate rows to {period_start, total_requests, errors}', async () => {
    h.executeRows = [
      { day: '2026-06-06T00:00:00.000Z', total_requests: '42' },
      { day: '2026-06-05T00:00:00.000Z', total_requests: '17' },
    ];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/daily-stats` });
    const body = res.json() as { data: Array<{ period_start: string; total_requests: number; errors: number }> };
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({ total_requests: 42, errors: 0 });
    expect(body.data[1]).toMatchObject({ total_requests: 17, errors: 0 });
    await app.close();
  });

  it('handles QueryResult object (rows property) vs bare array', async () => {
    // Drizzle execute() may return { rows: [...] } or a bare array depending on the driver
    h.executeRows = { rows: [{ day: '2026-06-06T00:00:00.000Z', total_requests: '5' }] } as unknown as unknown[];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/daily-stats` });
    const body = res.json() as { data: Array<{ total_requests: number }> };
    expect(body.data[0]!.total_requests).toBe(5);
    await app.close();
  });
});

// ── available-versions GET ──────────────────────────────────────────────────

describe('GET /platform/organizations/:slug/available-versions', () => {
  it('returns the Postgres 15 entry (was returning empty array)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/organizations/${SLUG}/available-versions` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ postgres_engine: string; displayName: string }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ postgres_engine: 'postgres', displayName: 'PostgreSQL 15' });
    await app.close();
  });

  it('POST version returns identical shape (both handlers consistent)', async () => {
    const app = await buildApp();
    const getRes = await app.inject({ method: 'GET', url: `/platform/organizations/${SLUG}/available-versions` });
    const postRes = await app.inject({ method: 'POST', url: `/platform/organizations/${SLUG}/available-versions` });
    expect(getRes.json()).toEqual(postRes.json());
    await app.close();
  });
});
