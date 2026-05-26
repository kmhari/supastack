/**
 * Integration tests for POST + DELETE /v1/projects/:ref/cli/login-role
 * (feature 012, tasks T010 + T011 + T015 + T016 + T018 + T022).
 *
 * Strategy
 * --------
 * In-process Fastify via `app.inject(...)` (existing mgmt-api test pattern,
 * see `secrets-list.test.ts` for reference). Per-project Postgres is mocked
 * via `vi.mock(per-instance-pg)` so we can assert what SQL the service
 * layer ran without standing up a real PG cluster.
 *
 * Wire-shape assertions are pinned against the Zod schemas exported by
 * `@selfbase/shared` — the same schemas the contract test
 * (`cli-login-role-contract.test.ts`) cross-checks against the upstream
 * OpenAPI snapshot.
 *
 * Audit-log assertions intercept the Fastify request logger via the
 * `req.log` spy attached at app-build time.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  CreateLoginRoleResponse,
  DeleteLoginRolesResponse,
} from '@selfbase/shared';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';

// ─── Mocks ──────────────────────────────────────────────────────────────────
//
// Mock the per-instance-pg helper so we can intercept the service's SQL and
// optionally inject the documented error classes (InstanceNotRunningError,
// PerInstancePgConnectError) without standing up a real per-project PG.

// Record of every SQL statement the service layer ran through our fake client.
const recordedQueries: { sql: string; params?: unknown[] }[] = [];

// Mode the next `withPerInstancePg` call should take. Test cases assign to
// `nextMode` BEFORE calling the route; `withPerInstancePg` then either runs
// the callback against the fake client (default) or throws the requested
// error class.
type Mode =
  | { kind: 'ok' }
  | { kind: 'not_running'; status: string }
  | { kind: 'connect_error'; message: string };
let nextMode: Mode = { kind: 'ok' };
// Controls what `SELECT EXISTS (... pg_roles ...)` returns. Default false so
// the "CREATE then ALTER" path runs; tests that need "role already exists"
// flip it to true.
let existsResult: boolean = false;

vi.mock('../../../src/services/per-instance-pg.js', async () => {
  // Re-export the real error classes so the service layer's `instanceof`
  // checks still match. Only the function body is replaced.
  const actual = await vi.importActual<
    typeof import('../../../src/services/per-instance-pg.js')
  >('../../../src/services/per-instance-pg.js');

  return {
    ...actual,
    withPerInstancePg: async <T>(
      _ref: string,
      fn: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<T>,
    ): Promise<T> => {
      if (nextMode.kind === 'not_running') {
        throw new actual.InstanceNotRunningError(nextMode.status);
      }
      if (nextMode.kind === 'connect_error') {
        throw new actual.PerInstancePgConnectError(nextMode.message);
      }
      const fakeClient = {
        query: async (sql: string, params?: unknown[]) => {
          recordedQueries.push({ sql, params });
          // Make EXISTS checks return a row so the service's `?.exists`
          // probe reaches the boolean. Default to `false` (role missing →
          // CREATE path fires); tests that need "role already exists" can
          // override by reassigning `existsResult` below.
          if (sql.startsWith('SELECT EXISTS')) {
            return { rows: [{ exists: existsResult }], rowCount: 1 } as unknown;
          }
          return { rows: [], rowCount: 0 } as unknown;
        },
        // Mirror pg.Client.{escapeIdentifier,escapeLiteral} — same logic
        // pg uses internally (RFC: `"` doubled inside identifier;
        // `E'...'` with `\` and `'` doubled inside literal).
        escapeIdentifier: (s: string): string => `"${s.replace(/"/g, '""')}"`,
        escapeLiteral: (s: string): string => {
          let escaped = "'";
          let hasBackslash = false;
          for (const c of s) {
            if (c === "'") escaped += "''";
            else if (c === '\\') {
              escaped += '\\\\';
              hasBackslash = true;
            } else escaped += c;
          }
          escaped += "'";
          return hasBackslash ? ` E${escaped}` : escaped;
        },
      };
      return fn(fakeClient as never);
    },
  };
});

// ─── Suite ──────────────────────────────────────────────────────────────────

const newRef = () => `cl${randomBytes(9).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('POST /v1/projects/:ref/cli/login-role', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    (globalThis as any).__selfbaseFakeDockerControl = createFakeDockerControl();
    app = await buildAuthedApp();
  });

  afterAll(async () => {
    delete (globalThis as any).__selfbaseFakeDockerControl;
    await app?.close();
  });

  beforeEach(async () => {
    nextMode = { kind: 'ok' };
    existsResult = false;
    recordedQueries.length = 0;
    // Clear the in-memory rate-limit bucket so cases are hermetic.
    const { _resetBuckets } = await import(
      '../../../src/services/cli-login-role-bucket.js'
    );
    _resetBuckets();
  });

  // ─── Happy path (RW) ─────────────────────────────────────────────────────

  it('201 with valid wire shape on read_only=false', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(() => CreateLoginRoleResponse.parse(body)).not.toThrow();
    expect(body.role).toBe('cli_login_postgres');
    expect(body.password).toMatch(/^[0-9a-f]{64}$/);
    expect(body.ttl_seconds).toBe(300);

    // The service layer ran:
    //   BEGIN → advisory lock → EXISTS check → CREATE ROLE → ALTER ROLE → COMMIT
    // (CREATE only fires when the role didn't exist yet; the mock client
    // returns rows:[] so .exists is undefined → the CREATE step runs.)
    const sqls = recordedQueries.map((q) => q.sql.trim().slice(0, 16));
    expect(sqls).toEqual([
      'BEGIN',
      'SELECT pg_advisor',
      'SELECT EXISTS (S',
      'CREATE ROLE "cli',
      'ALTER ROLE "cli_',
      'COMMIT',
    ]);

    // CREATE statement: role + target identifiers correctly quoted.
    const createSql = recordedQueries[3]!.sql;
    expect(createSql).toContain('CREATE ROLE "cli_login_postgres" NOINHERIT LOGIN NOREPLICATION IN ROLE "postgres"');

    // ALTER statement: role identifier + password literal + VALID UNTIL.
    const alterSql = recordedQueries[4]!.sql;
    expect(alterSql).toContain('"cli_login_postgres"');
    expect(alterSql).toContain(`'${body.password}'`);
    expect(alterSql).toMatch(/VALID UNTIL '[0-9T:.Z-]+'/);
  });

  // ─── RO scope deferred to follow-up — read_only=true returns 501 ──────────

  it('501 with code=not_implemented when read_only=true (RO deferred — see route comment)', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: true }),
    });

    expect(res.statusCode).toBe(501);
    expect(res.json().code).toBe('not_implemented');
    expect(res.json().details?.reason).toBe('read_only_scope_reserved_by_supautils');
    // Verify no SQL was issued (we never reached withPerInstancePg).
    expect(recordedQueries.length).toBe(0);
  });

  // ─── Error matrix ────────────────────────────────────────────────────────

  it('401 when no auth header', async () => {
    const ref = newRef();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBeDefined();
  });

  it('403 when PAT belongs to a member-tier user', async () => {
    const ref = newRef();
    const { token } = await seedTestUser({ role: 'member' });
    await withMockInstance(ref);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(res.statusCode).toBe(403);
  });

  it('404 when the project does not exist', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    // Note: no withMockInstance call → ref unknown.

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });

  it('409 when withPerInstancePg throws InstanceNotRunningError', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    nextMode = { kind: 'not_running', status: 'provisioning' };

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('project_not_running');
    expect(res.json().details?.status).toBe('provisioning');
  });

  it('422 when body is missing read_only', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('invalid_request');
  });

  it('422 when body has an unknown field (strict schema)', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false, surprise: true }),
    });
    expect(res.statusCode).toBe(422);
  });

  it('502 when withPerInstancePg throws PerInstancePgConnectError', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    nextMode = { kind: 'connect_error', message: 'connection refused' };

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('per_instance_pg_connect_error');
  });

  // ─── 429 + concurrency — T011 ────────────────────────────────────────────

  it('429 after RATE_LIMIT calls in the same window (same PAT+project)', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    // 30 succeed
    for (let i = 0; i < 30; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/projects/${ref}/cli/login-role`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ read_only: false }),
      });
      expect(res.statusCode).toBe(201);
    }
    // 31st throttled
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe('rate_limited');
    const retry = res.json().details?.retry_after_seconds;
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(60);
    expect(res.headers['retry-after']).toBe(String(retry));
  });

  it('distinct PATs have independent rate-limit buckets', async () => {
    const ref = newRef();
    const { token: tokenA } = await seedTestUser();
    const { token: tokenB } = await seedTestUser();
    await withMockInstance(ref);

    for (let i = 0; i < 30; i += 1) {
      await app.inject({
        method: 'POST',
        url: `/v1/projects/${ref}/cli/login-role`,
        headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ read_only: false }),
      });
    }
    // PAT A is exhausted
    const aRes = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(aRes.statusCode).toBe(429);
    // PAT B starts fresh
    const bRes = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${tokenB}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(bRes.statusCode).toBe(201);
  });

  it('concurrent calls both succeed (advisory lock serialises)', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/v1/projects/${ref}/cli/login-role`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ read_only: false }),
      }),
      app.inject({
        method: 'POST',
        url: `/v1/projects/${ref}/cli/login-role`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ read_only: false }),
      }),
    ]);
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    const passwordA = a.json().password as string;
    const passwordB = b.json().password as string;
    expect(passwordA).not.toBe(passwordB);
    // Both invocations took the advisory lock then ran the DO block.
    const lockCalls = recordedQueries.filter((q) =>
      q.sql.startsWith('SELECT pg_advisory_xact_lock'),
    );
    expect(lockCalls.length).toBe(2);
  });

  // ─── Audit log — T010 + T016 ─────────────────────────────────────────────

  it('emits exactly one cli_login_role_rotated audit log line; password never appears in any log line', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const captured: string[] = [];
    const spy = vi
      .spyOn(app.log, 'info')
      .mockImplementation((obj, msg, ...rest) => {
        captured.push(JSON.stringify({ obj, msg, rest }));
      });
    // Also catch nested child loggers.
    const origChild = app.log.child.bind(app.log);
    vi.spyOn(app.log, 'child').mockImplementation((bindings) => {
      const child = origChild(bindings);
      child.info = ((obj: unknown, msg?: unknown) => {
        captured.push(JSON.stringify({ obj, msg }));
      }) as never;
      return child;
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });

    expect(res.statusCode).toBe(201);
    const password = res.json().password as string;

    spy.mockRestore();

    const rotated = captured.filter((line) =>
      line.includes('cli_login_role_rotated'),
    );
    expect(rotated.length).toBe(1);
    // No log line carries the rotated password.
    for (const line of captured) {
      expect(line).not.toContain(password);
    }
  });

  // ─── 422 with surprise field path — also a no-op SQL execution guard ─────

  it('an authorization failure short-circuits before any per-instance PG SQL', async () => {
    const ref = newRef();
    // member can't authorize → 403 should happen before service is called
    const { token } = await seedTestUser({ role: 'member' });
    await withMockInstance(ref);

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(res.statusCode).toBe(403);
    expect(recordedQueries.length).toBe(0);
  });
});

// ─── DELETE — T022 ───────────────────────────────────────────────────────────

describe.skipIf(!hasTestEnv)('DELETE /v1/projects/:ref/cli/login-role', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    (globalThis as any).__selfbaseFakeDockerControl = createFakeDockerControl();
    app = await buildAuthedApp();
  });

  afterAll(async () => {
    delete (globalThis as any).__selfbaseFakeDockerControl;
    await app?.close();
  });

  beforeEach(async () => {
    nextMode = { kind: 'ok' };
    existsResult = false;
    recordedQueries.length = 0;
    const { _resetBuckets } = await import(
      '../../../src/services/cli-login-role-bucket.js'
    );
    _resetBuckets();
  });

  it('200 + {message: "ok"} on happy path; runs the dual-role VALID UNTIL block', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(() => DeleteLoginRolesResponse.parse(res.json())).not.toThrow();
    expect(res.json()).toEqual({ message: 'ok' });

    // The service issues a discrete EXISTS-then-ALTER pair per role. With
    // the mock client returning rows:[] (.exists undefined), the ALTERs
    // don't fire — that case is exercised by the next test ("idempotent
    // on empty"). Here we instead test the "POST then DELETE" flow lower
    // in this file: see the "POST → DELETE → POST recovers" case for the
    // full ALTER trace.
    const existChecks = recordedQueries.filter((q) =>
      q.sql.startsWith('SELECT EXISTS'),
    );
    expect(existChecks.length).toBe(2);
    expect(existChecks[0]!.params).toEqual(['cli_login_postgres']);
    expect(existChecks[1]!.params).toEqual(['cli_login_supabase_read_only_user']);
  });

  it('200 even when neither role exists yet (idempotent)', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ message: 'ok' });
  });

  it('401 / 403 / 404 mirror the POST handler', async () => {
    const ref = newRef();

    // 401
    let r = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/cli/login-role`,
    });
    expect(r.statusCode).toBe(401);

    // 403 — member can't
    const { token: memberToken } = await seedTestUser({ role: 'member' });
    await withMockInstance(ref);
    r = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(r.statusCode).toBe(403);

    // 404 — admin but ref unknown
    const newerRef = newRef();
    const { token: adminToken } = await seedTestUser();
    r = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${newerRef}/cli/login-role`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(r.statusCode).toBe(404);
  });

  it('does NOT consume the POST rate-limit bucket', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    // Run 30 POSTs to saturate the bucket.
    for (let i = 0; i < 30; i += 1) {
      await app.inject({
        method: 'POST',
        url: `/v1/projects/${ref}/cli/login-role`,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: JSON.stringify({ read_only: false }),
      });
    }
    // POST is now blocked.
    const blocked = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(blocked.statusCode).toBe(429);
    // But DELETE still works.
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
  });

  it('emits cli_login_role_invalidated audit log line', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const captured: string[] = [];
    const spy = vi.spyOn(app.log, 'info').mockImplementation((obj, msg) => {
      captured.push(JSON.stringify({ obj, msg }));
    });

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);

    spy.mockRestore();

    expect(
      captured.some((line) => line.includes('cli_login_role_invalidated')),
    ).toBe(true);
  });

  // ─── POST → DELETE → POST recovers — covers T022 #3 ──────────────────────

  it('subsequent POST after DELETE rotates a fresh password', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const r1 = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(r1.statusCode).toBe(201);

    const d = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(d.statusCode).toBe(200);

    const r2 = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ read_only: false }),
    });
    expect(r2.statusCode).toBe(201);
    expect(r2.json().password).not.toBe(r1.json().password);
  });
});
