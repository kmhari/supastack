/**
 * Real project health probe (GET /v1/projects/:ref/health).
 *
 * Spins up a real http.createServer to stand in for the per-instance Kong
 * (TEST_KONG_BASE_URL points the HTTP probes at it), and mocks the DB row,
 * per-instance Postgres, and runtime config so no live infra is needed.
 * Covers happy path (all healthy) + sad paths (service down, db down,
 * not-found, non-running short-circuits).
 */
import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// DB row driving probeProjectHealth. Tests mutate `instanceRow`.
let instanceRow: { status: string; portKong: number; encryptedSecrets: Buffer } | undefined;

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (instanceRow ? [instanceRow] : []),
        }),
      }),
    }),
  }),
  schema: {
    supabaseInstances: {
      status: 'status',
      portKong: 'portKong',
      encryptedSecrets: 'enc',
      ref: 'ref',
    },
  },
}));

vi.mock('@supastack/crypto', () => ({
  loadMasterKey: () => Buffer.alloc(32),
  decryptJson: () => ({ serviceRoleKey: 'svc-role-key' }),
}));

// Per-instance Postgres — `dbUp` decides whether `select 1` resolves.
let dbUp = true;
vi.mock('../../src/services/per-instance-pg.js', () => ({
  withPerInstancePg: async (_ref: string, fn: (c: unknown) => Promise<unknown>) => {
    if (!dbUp) throw new Error('connect ECONNREFUSED');
    return fn({ query: async () => ({ rows: [{ '?column?': 1 }] }) });
  },
}));

vi.mock('../../src/services/runtime-config-store.js', () => ({
  getConfig: async () => ({ db_schema: 'public,storage,graphql_public' }),
}));

// ─── Fake Kong upstream ───────────────────────────────────────────────────────

let server: http.Server;
let port: number;
// Per-path status the fake Kong returns. Default 200 for the health paths.
let pathStatus: Record<string, number> = {};
let lastHeaders: Record<string, string | string[] | undefined> = {};

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        lastHeaders = req.headers;
        const url = req.url ?? '';
        const status = pathStatus[url] ?? 200;
        res.writeHead(status, { 'content-type': 'application/json' });
        if (url.startsWith('/auth/v1/health')) {
          res.end(JSON.stringify({ version: 'v2.186.0', name: 'GoTrue', description: 'auth' }));
        } else {
          res.end(JSON.stringify({ ok: true }));
        }
      });
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as { port: number }).port;
        process.env.TEST_KONG_BASE_URL = `http://127.0.0.1:${port}`;
        resolve();
      });
    }),
);

afterAll(() => {
  delete process.env.TEST_KONG_BASE_URL;
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  instanceRow = { status: 'running', portKong: 1234, encryptedSecrets: Buffer.alloc(1) };
  dbUp = true;
  pathStatus = {};
});

// Import after mocks are registered.
const { probeProjectHealth, DEFAULT_HEALTH_SERVICES } =
  await import('../../src/services/project-health-service.js');

const byName = (svcs: { name: string }[], n: string) => svcs.find((s) => s.name === n)!;

describe('probeProjectHealth — happy path', () => {
  it('reports every default service ACTIVE_HEALTHY when running and reachable', async () => {
    const { services, notFound } = await probeProjectHealth('ref1', [...DEFAULT_HEALTH_SERVICES]);
    expect(notFound).toBeUndefined();
    expect(services.map((s) => s.name).sort()).toEqual([
      'auth',
      'db',
      'realtime',
      'rest',
      'storage',
    ]);
    for (const s of services) {
      expect(s.status).toBe('ACTIVE_HEALTHY');
      expect(s.healthy).toBe(true); // deprecated mirror
      expect(s.error).toBeUndefined();
    }
  });

  it('rest carries info.db_schema (so Studio reads PostgREST as enabled, not disabled)', async () => {
    const { services } = await probeProjectHealth('ref1', ['rest']);
    expect(byName(services, 'rest').info).toEqual({ db_schema: 'public,storage,graphql_public' });
  });

  it('auth carries GoTrue info parsed from /health', async () => {
    const { services } = await probeProjectHealth('ref1', ['auth']);
    expect(byName(services, 'auth').info).toMatchObject({ name: 'GoTrue', version: 'v2.186.0' });
  });

  it('sends the project service-role key so Kong key-auth/JWT routes are reachable', async () => {
    await probeProjectHealth('ref1', ['storage']);
    expect(lastHeaders['apikey']).toBe('svc-role-key');
    expect(lastHeaders['authorization']).toBe('Bearer svc-role-key');
  });
});

describe('probeProjectHealth — sad paths', () => {
  it('marks a service UNHEALTHY when Kong returns 5xx (container down)', async () => {
    pathStatus['/storage/v1/status'] = 503;
    const { services } = await probeProjectHealth('ref1', ['storage', 'auth']);
    expect(byName(services, 'storage').status).toBe('UNHEALTHY');
    expect(byName(services, 'storage').healthy).toBe(false);
    expect(byName(services, 'storage').error).toContain('503');
    // unaffected sibling stays healthy (probes are independent)
    expect(byName(services, 'auth').status).toBe('ACTIVE_HEALTHY');
  });

  it('marks db UNHEALTHY when select 1 fails', async () => {
    dbUp = false;
    const { services } = await probeProjectHealth('ref1', ['db']);
    expect(byName(services, 'db').status).toBe('UNHEALTHY');
    expect(byName(services, 'db').error).toBe('database unreachable');
  });

  it('returns notFound for an unknown ref', async () => {
    instanceRow = undefined;
    const res = await probeProjectHealth('nope', ['db']);
    expect(res.notFound).toBe(true);
    expect(res.services).toEqual([]);
  });

  it('short-circuits to COMING_UP while provisioning/restoring (no probing)', async () => {
    instanceRow = { status: 'provisioning', portKong: 1234, encryptedSecrets: Buffer.alloc(1) };
    const { services } = await probeProjectHealth('ref1', [...DEFAULT_HEALTH_SERVICES]);
    expect(services.every((s) => s.status === 'COMING_UP')).toBe(true);
  });

  it('short-circuits to UNHEALTHY when paused/stopped/failed', async () => {
    instanceRow = { status: 'paused', portKong: 1234, encryptedSecrets: Buffer.alloc(1) };
    const { services } = await probeProjectHealth('ref1', [...DEFAULT_HEALTH_SERVICES]);
    expect(services.every((s) => s.status === 'UNHEALTHY' && s.healthy === false)).toBe(true);
  });
});
