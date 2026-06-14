import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * Feature 086 US6 — the platform studio restore + status routes:
 *   POST /platform/database/:ref/backups/restore-physical  ({id:number} → 201)
 *   GET  /platform/projects/:ref/status                    (running→ACTIVE_HEALTHY, restoring→RESTORING)
 */

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
  isNull: () => ({}),
  sql: () => ({}),
}));

// Configurable holders (hoisted so the vi.mock factories can close over them).
const h = vi.hoisted(() => {
  class MockRestoreError extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
      this.name = 'RestoreError';
    }
  }
  return {
    dbRows: [] as unknown[], // what the membership/status lookup returns
    svc: {
      resolveBackupSeq: vi.fn(),
      initiateRestore: vi.fn(),
      enqueueRestore: vi.fn(),
      listBackupsForPlatform: vi.fn(),
    },
    MockRestoreError,
  };
});

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
  resolveBackupSeq: h.svc.resolveBackupSeq,
  initiateRestore: h.svc.initiateRestore,
  enqueueRestore: h.svc.enqueueRestore,
  listBackupsForPlatform: h.svc.listBackupsForPlatform,
  RestoreError: h.MockRestoreError,
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

type Role = 'owner' | 'administrator' | 'developer' | 'read_only';
async function buildApp(role: Role = 'owner'): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role }));
  app.decorate('authorize', () => {});
  app.decorate('authorizeOrg', async () => role);
  await app.register(platformMiscRoutes);
  return app;
}

beforeEach(() => {
  h.dbRows = [{ ref: 'r', status: 'running' }];
  h.svc.resolveBackupSeq.mockReset();
  h.svc.initiateRestore.mockReset();
  h.svc.enqueueRestore.mockReset();
});

const REF = 'abcdefghijklmnopqrst';

describe('POST /platform/database/:ref/backups/restore-physical (US6)', () => {
  it('happy: ref-scoped seq resolves → 201 + enqueues', async () => {
    h.svc.resolveBackupSeq.mockResolvedValue('uuid-42');
    h.svc.initiateRestore.mockResolvedValue({
      restore_job_id: 'rj1',
      status: 'pending',
      backup_id: 'uuid-42',
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/database/${REF}/backups/restore-physical`,
      payload: { id: 42 },
    });
    expect(res.statusCode).toBe(201);
    expect(h.svc.resolveBackupSeq).toHaveBeenCalledWith(REF, 42);
    expect(h.svc.enqueueRestore).toHaveBeenCalledWith('rj1');
    await app.close();
  });

  it('sad: unknown / cross-project seq (resolve → null) → 404, no restore', async () => {
    h.svc.resolveBackupSeq.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/database/${REF}/backups/restore-physical`,
      payload: { id: 999 },
    });
    expect(res.statusCode).toBe(404);
    expect(h.svc.initiateRestore).not.toHaveBeenCalled();
    await app.close();
  });

  it('sad: non-numeric id → 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/database/${REF}/backups/restore-physical`,
      payload: { id: 'abc' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('sad: restore already in progress → 409', async () => {
    h.svc.resolveBackupSeq.mockResolvedValue('uuid-42');
    h.svc.initiateRestore.mockRejectedValue(
      new h.MockRestoreError('restore_in_progress', 'in progress'),
    );
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/database/${REF}/backups/restore-physical`,
      payload: { id: 42 },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('sad: project not a member → 404', async () => {
    h.dbRows = [];
    h.svc.resolveBackupSeq.mockResolvedValue('uuid-42');
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/database/${REF}/backups/restore-physical`,
      payload: { id: 42 },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('GET /platform/projects/:ref/status (US6)', () => {
  it('running → ACTIVE_HEALTHY', async () => {
    h.dbRows = [{ status: 'running' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/status` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ACTIVE_HEALTHY');
    await app.close();
  });

  it('restoring → RESTORING', async () => {
    h.dbRows = [{ status: 'restoring' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/status` });
    expect(res.json().status).toBe('RESTORING');
    await app.close();
  });

  it('unknown project → 404', async () => {
    h.dbRows = [];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/projects/${REF}/status` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
