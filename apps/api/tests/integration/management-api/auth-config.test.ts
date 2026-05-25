/**
 * T032-T036 — integration tests for /v1/projects/:ref/config/auth.
 *
 * Covers spec FR-003 (GET shape + redaction), FR-004 (PATCH + sentinel
 * merge + stored-only fields), FR-005 (validation), FR-006 (no forced
 * sign-outs), FR-007 (restart-failure rollback), FR-010 (audit on
 * success only), SC-003 (no audit on rejected PATCH).
 *
 * Each test seeds a fresh user + mock instance + .env file under a
 * test-only INSTANCES_DIR. The fake docker-control records restart calls
 * without touching real containers. The Redis lock uses TEST_REDIS_URL.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import { REDACTED_SECRET } from '@selfbase/shared';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';

const newRef = () => `ac${randomBytes(9).toString('hex')}`.slice(0, 20);

async function seedEnv(ref: string): Promise<string> {
  const instancesDir = process.env.INSTANCES_DIR ?? '/tmp/selfbase-test-instances';
  const envPath = path.join(instancesDir, ref, '.env');
  await mkdir(path.dirname(envPath), { recursive: true });
  await writeFile(
    envPath,
    'JWT_EXPIRY=3600\nSITE_URL=https://old.example\nENABLE_EMAIL_SIGNUP=true\n',
    { mode: 0o600 },
  );
  return envPath;
}

describe.skipIf(!hasTestEnv)('PATCH /v1/projects/:ref/config/auth', () => {
  let app: FastifyInstance;
  let fakeDocker: ReturnType<typeof createFakeDockerControl>;

  beforeAll(async () => {
    fakeDocker = createFakeDockerControl();
    (globalThis as any).__selfbaseFakeDockerControl = fakeDocker;
    app = await buildAuthedApp();
  });

  beforeEach(() => {
    fakeDocker.restartCalls.length = 0;
    fakeDocker.waitHealthyCalls.length = 0;
  });

  afterAll(async () => {
    delete (globalThis as any).__selfbaseFakeDockerControl;
    await app?.close();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T032 — happy path
  // ──────────────────────────────────────────────────────────────────────────
  it('T032 happy path: PATCH jwt_exp=86400 → GET reflects + .env updated + container restarted', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    const envPath = await seedEnv(ref);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/config/auth`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ jwt_exp: 86400 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jwt_exp: 86400 });

    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/config/auth`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(200);
    expect((getRes.json() as { jwt_exp: number }).jwt_exp).toBe(86400);

    const env = await readFile(envPath, 'utf8');
    expect(env).toContain('JWT_EXPIRY=86400');
    expect(fakeDocker.restartCalls).toEqual([`selfbase-${ref}-auth-1`]);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T033 — validation rejection + SC-003 (no .env write, no restart, no audit)
  // ──────────────────────────────────────────────────────────────────────────
  it('T033 jwt_exp=700000 → 400 with per-field detail; no .env write; no restart; no audit', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    const envPath = await seedEnv(ref);
    const envBefore = await readFile(envPath, 'utf8');
    const auditCountBefore = (
      await db()
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, 'mgmt_api.auth_config.update'))
    ).length;

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/config/auth`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ jwt_exp: 700_000 }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { details?: Record<string, unknown> };
    expect(body.details).toBeDefined();

    expect(await readFile(envPath, 'utf8')).toBe(envBefore);
    expect(fakeDocker.restartCalls).toEqual([]);
    const auditCountAfter = (
      await db()
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, 'mgmt_api.auth_config.update'))
    ).length;
    expect(auditCountAfter).toBe(auditCountBefore);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T034 — secret round-trip with *** sentinel
  // ──────────────────────────────────────────────────────────────────────────
  it('T034 GET → modify → PATCH full body back: secret unchanged (round-trip safe)', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    await seedEnv(ref);

    // Seed a real OAuth secret via a first PATCH.
    const seedRes = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/config/auth`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        external_google_enabled: true,
        external_google_client_id: 'abc.apps.googleusercontent.com',
        external_google_secret: 'super-secret-plaintext',
      }),
    });
    expect(seedRes.statusCode).toBe(200);
    expect((seedRes.json() as any).external_google_secret).toBe(REDACTED_SECRET);

    // GET — secret comes back redacted.
    const getRes = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/config/auth`,
      headers: { authorization: `Bearer ${token}` },
    });
    const got = getRes.json() as Record<string, unknown>;
    expect(got.external_google_secret).toBe(REDACTED_SECRET);
    expect(got.external_google_client_id).toBe('abc.apps.googleusercontent.com');

    // PATCH the whole body back unchanged (CLI round-trip simulation).
    const echoRes = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/config/auth`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify(got),
    });
    expect(echoRes.statusCode).toBe(200);

    // Underlying plaintext snapshot must still hold the original secret.
    const [row] = await db()
      .select({ payload: schema.projectConfigSnapshots.encryptedPayload })
      .from(schema.projectConfigSnapshots)
      .where(
        and(
          eq(schema.projectConfigSnapshots.instanceRef, ref),
          eq(schema.projectConfigSnapshots.surface, 'auth'),
        ),
      );
    const plain = decryptJson<Record<string, unknown>>(row!.payload, loadMasterKey());
    expect(plain.external_google_secret).toBe('super-secret-plaintext');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T035 — OAuth missing-credentials cross-field validation
  // ──────────────────────────────────────────────────────────────────────────
  it('T035 enabling github without client_id/secret → 400 missing_credentials', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    await seedEnv(ref);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/config/auth`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ external_github_enabled: true }),
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { details?: Record<string, unknown> };
    expect(body.details?.external_github).toBe('missing_credentials');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // T036 — failed-restart rollback (FR-007 + SC-006)
  // ──────────────────────────────────────────────────────────────────────────
  it('T036 container restart fails → 500 restart_failed + .env rolled back + GET reflects prior', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    const envPath = await seedEnv(ref);
    const envBefore = await readFile(envPath, 'utf8');

    // Override restart to throw — simulating GoTrue refusing the new env.
    const originalRestart = fakeDocker.restart;
    fakeDocker.restart = async (c: string) => {
      fakeDocker.restartCalls.push(c);
      throw new Error('container refused to start with new env');
    };

    try {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/projects/${ref}/config/auth`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ site_url: 'https://new.example' }),
      });
      expect(res.statusCode).toBe(500);
      expect((res.json() as any).code).toBe('restart_failed');

      // .env restored to prior content.
      expect(await readFile(envPath, 'utf8')).toBe(envBefore);

      // GET still reflects the prior site_url default (no snapshot row written
      // because patchConfig wrote the snapshot AFTER applyEnvAndRestart — see
      // runtime-config-store.ts pipeline order).
      const getRes = await app.inject({
        method: 'GET',
        url: `/v1/projects/${ref}/config/auth`,
        headers: { authorization: `Bearer ${token}` },
      });
      const got = getRes.json() as { site_url?: string };
      expect(got.site_url).not.toBe('https://new.example');
    } finally {
      fakeDocker.restart = originalRestart;
    }
  });
});

describe.skipIf(!hasTestEnv)('GET /v1/projects/:ref/config/auth defaults', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    (globalThis as any).__selfbaseFakeDockerControl = createFakeDockerControl();
    app = await buildAuthedApp();
  });

  afterAll(async () => {
    delete (globalThis as any).__selfbaseFakeDockerControl;
    await app?.close();
  });

  it('returns upstream-documented defaults for a project with no snapshot row', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/config/auth`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.jwt_exp).toBe(3600);
    expect(body.disable_signup).toBe(false);
  });
});
