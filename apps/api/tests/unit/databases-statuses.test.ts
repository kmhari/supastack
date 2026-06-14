import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * #106 — `/platform/projects/:ref/databases-statuses` previously returned a
 * hardcoded `ACTIVE_HEALTHY`; now it reflects the real `supabaseInstances.status`
 * (org-scoped), via the shared `toStudioProjectStatus` mapping, so the per-database
 * list agrees with the project badge (`/status`) during a restore.
 */

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
  sql: () => ({}),
}));

const h = vi.hoisted(() => ({ dbRows: [] as unknown[] }));

vi.mock('@supastack/db', () => {
  const obj: Record<string, unknown> = {
    from: () => obj,
    innerJoin: () => obj,
    where: () => obj,
    limit: () => Promise.resolve(h.dbRows),
  };
  return {
    db: () => ({ select: () => obj }),
    schema: {
      supabaseInstances: { ref: {}, status: {}, orgId: {} },
      organizationMembers: { organizationId: {}, userId: {} },
    },
  };
});
vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  loadMasterKey: () => Buffer.alloc(32),
}));
vi.mock('../../src/services/backups-mgmt-service.js', () => ({
  resolveBackupSeq: vi.fn(),
  initiateRestore: vi.fn(),
  enqueueRestore: vi.fn(),
  listBackupsForPlatform: vi.fn(),
  RestoreError: class RestoreError extends Error {},
}));

const { platformMiscRoutes, toStudioProjectStatus } =
  await import('../../src/routes/platform-misc.js');

type Role = 'owner' | 'administrator' | 'developer' | 'read_only';
async function buildApp(role: Role = 'owner'): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role }));
  app.decorate('authorize', () => {});
  app.decorate('authorizeOrg', async () => role);
  await app.register(platformMiscRoutes);
  return app;
}

const REF = 'abcdefghijklmnopqrst';

describe('toStudioProjectStatus (#106 — single source of the status mapping)', () => {
  it('running → ACTIVE_HEALTHY', () =>
    expect(toStudioProjectStatus('running')).toBe('ACTIVE_HEALTHY'));
  it('restoring → RESTORING', () => expect(toStudioProjectStatus('restoring')).toBe('RESTORING'));
  it('paused → PAUSED', () => expect(toStudioProjectStatus('paused')).toBe('PAUSED'));
});

describe('GET /platform/projects/:ref/databases-statuses (#106)', () => {
  beforeEach(() => {
    h.dbRows = [{ status: 'running' }];
  });

  it('reflects real status — restoring → RESTORING (was a hardcoded ACTIVE_HEALTHY stub)', async () => {
    h.dbRows = [{ status: 'restoring' }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/databases-statuses`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ identifier: REF, status: 'RESTORING' }]);
    await app.close();
  });

  it('running → ACTIVE_HEALTHY', async () => {
    h.dbRows = [{ status: 'running' }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/databases-statuses`,
    });
    expect(res.json()).toEqual([{ identifier: REF, status: 'ACTIVE_HEALTHY' }]);
    await app.close();
  });

  it('non-member project → 404 (org-scoped, which the old stub lacked)', async () => {
    h.dbRows = [];
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/projects/${REF}/databases-statuses`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
