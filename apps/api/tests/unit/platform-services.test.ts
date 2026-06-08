import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

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
  dbRows: [] as unknown[],
  dbReject: null as Error | null,
}));

vi.mock('@supastack/db', () => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => (h.dbReject ? Promise.reject(h.dbReject) : Promise.resolve(h.dbRows)),
  };
  return {
    db: () => ({ select: () => chain, execute: () => Promise.resolve([]) }),
    schema: {
      backups: { seq: {}, startedAt: {}, completedAt: {}, sizeBytes: {}, instanceRef: {}, status: {} },
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
  await app.register(platformMiscRoutes);
  return app;
}

beforeEach(() => {
  h.dbRows = [];
  h.dbReject = null;
});

describe('GET /platform/projects/:ref/services', () => {
  it('running project → 200 with 10-element services array, each having name + ACTIVE_HEALTHY status', async () => {
    h.dbRows = [{ ref: REF, status: 'running' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/services` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string; status: string }>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(10);
    expect(body.every((s) => typeof s.name === 'string')).toBe(true);
    expect(body.every((s) => s.status === 'ACTIVE_HEALTHY')).toBe(true);
    await app.close();
  });

  it('paused project → 200 with non-ACTIVE_HEALTHY status for all services', async () => {
    h.dbRows = [{ ref: REF, status: 'paused' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/services` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ status: string }>;
    expect(body.every((s) => s.status !== 'ACTIVE_HEALTHY')).toBe(true);
    await app.close();
  });

  it('unknown project ref → 404', async () => {
    h.dbRows = [];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/services` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('unauthenticated request → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/services` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('DB error → 500', async () => {
    h.dbReject = new Error('connection lost');
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/services` });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
