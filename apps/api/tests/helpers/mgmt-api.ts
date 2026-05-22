/**
 * Test helpers for the Supabase CLI compatibility (P0) management-API surface.
 *
 * Spec: specs/003-supabase-cli-compat-p0/tasks.md T003
 *
 * Coexists with the existing live-API contract test pattern (which uses
 * `TEST_API_URL` + `fetch` and `describe.skipIf(!API)`). The mgmt-API tests
 * use **in-process Fastify** via `app.inject()` so they're CI-runnable
 * without spinning up a real server. They DO still need a real Postgres at
 * `TEST_DATABASE_URL` plus Redis at `TEST_REDIS_URL` — see `skipIfNoTestEnv`.
 *
 * Container side-effects (docker restart) are short-circuited via a recorded
 * fake docker-control that callers can inspect.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '@selfbase/db';
import { encryptInstanceSecrets, generateInstanceSecrets } from '../../src/services/instance-secrets.js';

/**
 * Skip the whole `describe(...)` block if the test environment isn't ready.
 * Returns a boolean usable in `describe.skipIf(...)`.
 */
export const hasTestEnv = Boolean(
  process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL && process.env.TEST_MASTER_KEY,
);

/**
 * Build a fresh Fastify instance against the test DB + Redis. Throws if env
 * isn't set (use `hasTestEnv` to gate the test block first).
 *
 * NOTE: the import is lazy because `buildApp()` calls `preflightGuards()` at
 * module load and we want the env to be set FIRST.
 */
export async function buildAuthedApp(): Promise<FastifyInstance> {
  if (!hasTestEnv) {
    throw new Error('TEST_DATABASE_URL / TEST_REDIS_URL / TEST_MASTER_KEY required');
  }
  // Mirror test env into the real env names buildApp reads.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  process.env.REDIS_URL = process.env.TEST_REDIS_URL;
  process.env.MASTER_KEY = process.env.TEST_MASTER_KEY;
  process.env.SESSION_SECRET ??= randomBytes(32).toString('hex');
  process.env.COOKIE_SECURE = '0';
  // Force the per-instance volumes onto a tempdir so withMockInstance can lay
  // out function directories without touching /var/selfbase.
  process.env.INSTANCES_DIR ??= '/tmp/selfbase-test-instances';

  const { buildApp } = await import('../../src/server.js');
  const app = await buildApp();
  await app.ready();
  return app;
}

/**
 * Insert an api_tokens row for `userId` and return the plaintext PAT.
 *
 * Format mirrors T005's mintApiToken: `sbp_<40 hex>`. The hash column gets
 * SHA-256 of the plaintext. T004 adds the `prefix` column; once the migration
 * is live this helper writes it too — until then it silently degrades.
 */
export async function mintTestToken(
  userId: string,
  label: string = 'cli-e2e-test',
): Promise<string> {
  const raw = `sbp_${randomBytes(20).toString('hex')}`;
  const tokenSha256 = createHash('sha256').update(raw, 'utf8').digest();
  // After T004 ships, `prefix` exists; before then the column is absent and
  // Drizzle's insert ignores any unknown values silently when using `.values()`
  // — but only if the schema TYPE doesn't list it. So we MUST switch the
  // schema first (T004) then this insert.
  await db()
    .insert(schema.apiTokens)
    .values({ userId, tokenSha256, label });
  return raw;
}

/**
 * Provision a fake `supabase_instances` row plus a per-instance volume tree
 * on disk under `${INSTANCES_DIR}/<ref>/volumes/functions/`. Returns the row
 * and the path so the test can drop files into the volume directly.
 */
export async function withMockInstance(ref: string) {
  const secrets = generateInstanceSecrets({ jwtExpirySec: 3600 });
  const encryptedSecrets = encryptInstanceSecrets(secrets);
  const instancesDir = process.env.INSTANCES_DIR ?? '/tmp/selfbase-test-instances';
  const volume = path.join(instancesDir, ref, 'volumes', 'functions');
  await mkdir(volume, { recursive: true });

  const [row] = await db()
    .insert(schema.supabaseInstances)
    .values({
      ref,
      name: `Test ${ref}`,
      status: 'running',
      encryptedSecrets,
      // Other required columns get default values from the schema.
    } as any)
    .returning();

  return { row, volumePath: volume, secrets };
}

/**
 * Recorded fake docker-control. Inject via the routes' service constructor or
 * via module-mock (vi.mock) — the deploy/secret services in T038/T048 should
 * accept the dockerControl client as a parameter so the test can swap it in.
 *
 * Usage:
 *   const fake = createFakeDockerControl();
 *   ... deploy a function ...
 *   expect(fake.restartCalls).toEqual(['selfbase-myref-functions-1']);
 */
export function createFakeDockerControl() {
  const restartCalls: string[] = [];
  const waitHealthyCalls: string[] = [];
  return {
    restartCalls,
    waitHealthyCalls,
    async restart(container: string) {
      restartCalls.push(container);
    },
    async waitHealthy(container: string, _timeoutMs?: number) {
      waitHealthyCalls.push(container);
    },
  };
}
