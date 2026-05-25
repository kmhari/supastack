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
  const prefix = raw.slice(0, 12);
  await db().insert(schema.apiTokens).values({ userId, tokenSha256, label, prefix });
  return raw;
}

/**
 * Seed a complete authentication context: a user, the singleton org (if
 * absent), an org_members row, and a PAT bound to the user. Returns every
 * id the test will need plus the plaintext token.
 *
 * The auth plugin's bearer-token path joins users + org_members; without
 * an org membership the user isn't visible to authenticated routes.
 */
export async function seedTestUser(opts: {
  email?: string;
  role?: 'admin' | 'member';
} = {}) {
  const email = opts.email ?? `test-${randomBytes(4).toString('hex')}@selfbase.test`;
  const [user] = await db()
    .insert(schema.users)
    .values({ email, hashedPassword: 'unused' })
    .returning({ id: schema.users.id });
  if (!user) throw new Error('failed to insert test user');

  // Org may already exist (singleton). Insert if missing.
  const existingOrgs = await db().select({ id: schema.org.id }).from(schema.org).limit(1);
  const orgId = existingOrgs[0]?.id
    ?? (await db()
      .insert(schema.org)
      .values({ name: 'Test Org' })
      .returning({ id: schema.org.id }))[0]!.id;

  await db()
    .insert(schema.orgMembers)
    .values({ orgId, userId: user.id, role: opts.role ?? 'admin' });

  const token = await mintTestToken(user.id);
  return { userId: user.id, email, orgId, token };
}

/**
 * Provision a fake `supabase_instances` row plus a per-instance volume tree
 * on disk under `${INSTANCES_DIR}/<ref>/volumes/functions/`. Returns the row
 * and the path so the test can drop files into the volume directly.
 */
export async function withMockInstance(ref: string, opts: { orgId?: string } = {}) {
  const secrets = generateInstanceSecrets({ jwtExpirySec: 3600 });
  const encryptedSecrets = encryptInstanceSecrets(secrets);
  const instancesDir = process.env.INSTANCES_DIR ?? '/tmp/selfbase-test-instances';
  const volume = path.join(instancesDir, ref, 'volumes', 'functions');
  await mkdir(volume, { recursive: true });

  // org_id is NOT NULL. If caller didn't pass one, pick up the first existing
  // org (created by an earlier seedTestUser call) or insert a fresh singleton.
  let orgId = opts.orgId;
  if (!orgId) {
    const existing = await db().select({ id: schema.org.id }).from(schema.org).limit(1);
    orgId = existing[0]?.id
      ?? (await db()
        .insert(schema.org)
        .values({ name: 'Test Org' })
        .returning({ id: schema.org.id }))[0]!.id;
  }

  // Allocate unique ports across concurrent test runs; the port_* columns are
  // .unique() so colliding refs in the same test DB would fail.
  const portBase = 30000 + Math.floor(Math.random() * 30000);
  const [row] = await db()
    .insert(schema.supabaseInstances)
    .values({
      ref,
      orgId,
      name: `Test ${ref}`,
      status: 'running',
      supabaseVersion: 'test',
      encryptedSecrets,
      portKong: portBase,
      portStudio: portBase + 1,
      portPostgres: portBase + 2,
      portPooler: portBase + 3,
      portAnalytics: portBase + 4,
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
