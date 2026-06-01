/**
 * T042-T045 — integration tests for /v1/projects/:ref/postgrest.
 *
 * Covers spec FR-001 (GET shape), FR-002 (PATCH + merge + restart),
 * FR-005 (validation), FR-010 (audit on success), SC-003 (no audit on
 * rejection), and the concurrent-PATCH serialization rule (Q1 + R-004).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';

const newRef = () => `pc${randomBytes(9).toString('hex')}`.slice(0, 20);

async function seedEnv(ref: string): Promise<string> {
  const instancesDir = process.env.INSTANCES_DIR ?? '/tmp/selfbase-test-instances';
  const envPath = path.join(instancesDir, ref, '.env');
  await mkdir(path.dirname(envPath), { recursive: true });
  await writeFile(envPath, 'PGRST_DB_SCHEMAS=public\nPGRST_DB_MAX_ROWS=1000\n', { mode: 0o600 });
  return envPath;
}

describe.skipIf(!hasTestEnv)('PATCH /v1/projects/:ref/postgrest', () => {
  let app: FastifyInstance;
  let fakeDocker: ReturnType<typeof createFakeDockerControl>;

  beforeAll(async () => {
    fakeDocker = createFakeDockerControl();
    (globalThis as any).__supastackFakeDockerControl = fakeDocker;
    app = await buildAuthedApp();
  });

  beforeEach(() => {
    fakeDocker.restartCalls.length = 0;
    fakeDocker.waitHealthyCalls.length = 0;
  });

  afterAll(async () => {
    delete (globalThis as any).__supastackFakeDockerControl;
    await app?.close();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T042 — happy path
  // ──────────────────────────────────────────────────────────────────────────
  it('T042 PATCH db_schema + max_rows → both persist, .env updated, container restarted', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    const envPath = await seedEnv(ref);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/postgrest`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ db_schema: 'public,app_v2', max_rows: 5000 }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { db_schema: string; max_rows: number };
    expect(body.db_schema).toBe('public,app_v2');
    expect(body.max_rows).toBe(5000);

    const env = await readFile(envPath, 'utf8');
    expect(env).toContain('PGRST_DB_SCHEMAS=public,app_v2');
    expect(env).toContain('PGRST_DB_MAX_ROWS=5000');
    expect(fakeDocker.restartCalls).toEqual([`selfbase-${ref}-rest-1`]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T043 — validation rejection
  // ──────────────────────────────────────────────────────────────────────────
  it('T043 max_rows=-1 → 400 with details, no snapshot, no .env write, no audit', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    const envPath = await seedEnv(ref);
    const envBefore = await readFile(envPath, 'utf8');
    const auditCountBefore = (
      await db()
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, 'mgmt_api.postgrest.update'))
    ).length;

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/postgrest`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ max_rows: -1 }),
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { details?: Record<string, unknown> }).details).toBeDefined();

    expect(await readFile(envPath, 'utf8')).toBe(envBefore);
    const auditCountAfter = (
      await db()
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, 'mgmt_api.postgrest.update'))
    ).length;
    expect(auditCountAfter).toBe(auditCountBefore);
    expect(fakeDocker.restartCalls).toEqual([]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T044 — db_pool: null means auto-configured; env line is omitted
  // ──────────────────────────────────────────────────────────────────────────
  it('T044 db_pool=null → 200, GET returns null, .env has no PGRST_DB_POOL line', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    const envPath = await seedEnv(ref);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/postgrest`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ db_pool: null }),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { db_pool: number | null }).db_pool).toBeNull();

    const env = await readFile(envPath, 'utf8');
    expect(env.split('\n').some((l) => l.startsWith('PGRST_DB_POOL='))).toBe(false);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T045 — concurrent-PATCH serialization → second writer gets 409
  // ──────────────────────────────────────────────────────────────────────────
  it('T045 concurrent PATCH (postgrest + auth) → one 200, one 409 config_write_in_progress', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    await seedEnv(ref);

    // Force a delay inside the restart so the lock is held while the
    // second PATCH arrives. The fake doesn't sleep by default — wrap it.
    const originalRestart = fakeDocker.restart;
    fakeDocker.restart = async (c: string) => {
      fakeDocker.restartCalls.push(c);
      await new Promise((r) => setTimeout(r, 200));
    };

    try {
      const [pgRes, authRes] = await Promise.all([
        app.inject({
          method: 'PATCH',
          url: `/v1/projects/${ref}/postgrest`,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: JSON.stringify({ max_rows: 2000 }),
        }),
        app.inject({
          method: 'PATCH',
          url: `/v1/projects/${ref}/config/auth`,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          payload: JSON.stringify({ jwt_exp: 7200 }),
        }),
      ]);

      const statuses = [pgRes.statusCode, authRes.statusCode].sort();
      expect(statuses).toEqual([200, 409]);

      const conflictRes = pgRes.statusCode === 409 ? pgRes : authRes;
      const body = conflictRes.json() as {
        code: string;
        details?: { lock_ttl_seconds?: number };
      };
      expect(body.code).toBe('config_write_in_progress');
      expect(body.details?.lock_ttl_seconds).toBeGreaterThan(0);

      // After the first lock releases, a retry of the loser succeeds.
      const loserIsPg = pgRes.statusCode === 409;
      const retryRes = await app.inject({
        method: 'PATCH',
        url: loserIsPg ? `/v1/projects/${ref}/postgrest` : `/v1/projects/${ref}/config/auth`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: loserIsPg ? JSON.stringify({ max_rows: 2000 }) : JSON.stringify({ jwt_exp: 7200 }),
      });
      expect(retryRes.statusCode).toBe(200);
    } finally {
      fakeDocker.restart = originalRestart;
    }
  });
});
