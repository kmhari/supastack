/**
 * Fake-Upstream Integration Tests (US2 — feature 113)
 *
 * Spins up a real http.createServer on a random port (port 0) and sets
 * TEST_KONG_BASE_URL so proxyToKong calls the fake server instead of Kong.
 * resolveInstance is mocked so no real DB is needed.
 *
 * Each test asserts the exact path / headers / body that the fake upstream
 * received — catching regressions in path rewriting, body normalisation, and
 * header injection without any live infrastructure.
 */
import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

// ─── Fake upstream ────────────────────────────────────────────────────────────

interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let lastRequest: CapturedRequest | null = null;
let fakeServer: http.Server;
let fakePort: number;
// Tests can force the next upstream response status/body to exercise error paths.
let nextResponseStatus = 200;
let nextResponseBody: string = JSON.stringify([]);

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      fakeServer = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
          lastRequest = {
            method: req.method ?? '',
            path: req.url ?? '',
            headers: req.headers as Record<string, string | string[] | undefined>,
            body: Buffer.concat(chunks).toString(),
          };
          res.writeHead(nextResponseStatus, { 'content-type': 'application/json' });
          res.end(nextResponseBody);
        });
      });
      fakeServer.listen(0, '127.0.0.1', () => {
        fakePort = (fakeServer.address() as { port: number }).port;
        resolve();
      });
    }),
);

afterAll(() => new Promise<void>((resolve) => fakeServer.close(() => resolve())));

// ─── Mock resolveInstance ─────────────────────────────────────────────────────

vi.mock('../../src/services/platform-proxy-helpers.js', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('../../src/services/platform-proxy-helpers.js')>();
  const inst = {
    portKong: 0,
    serviceRoleKey: 'test-srk',
    dashboardPassword: 'test-dp',
    logflarePrivateAccessToken: 'test-lpat',
  };
  return {
    ...real,
    resolveInstance: vi.fn().mockResolvedValue(inst),
    // SEC-001: the proxy now resolves via the org-scoped chokepoint. This test
    // isn't exercising authz, so return the same instance.
    authorizeAndResolveInstance: vi.fn().mockResolvedValue(inst),
  };
});

// ─── App builder ─────────────────────────────────────────────────────────────

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', (_req: FastifyRequest) => ({
    id: 'user-1',
    email: 'test@example.com',
    role: 'owner' as const,
  }));
  const { platformProxyRoutes } = await import('../../src/routes/platform-proxy.js');
  await app.register(platformProxyRoutes);
  return app;
}

let app: FastifyInstance;

beforeEach(async () => {
  lastRequest = null;
  nextResponseStatus = 200;
  nextResponseBody = JSON.stringify([]);
  process.env.TEST_KONG_BASE_URL = `http://127.0.0.1:${fakePort}`;
  app = await buildApp();
});

afterEach(async () => {
  delete process.env.TEST_KONG_BASE_URL;
  await app.close();
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Fake-upstream proxy contract tests', () => {
  describe('pg-meta', () => {
    it('forwards GET /platform/pg-meta/:ref/tables to /pg/tables with apikey + Authorization headers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/platform/pg-meta/testref/tables',
        headers: { authorization: 'Bearer user-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.path).toBe('/pg/tables');
      expect(lastRequest!.method).toBe('GET');
      expect(lastRequest!.headers['apikey']).toBe('test-srk');
      expect(lastRequest!.headers['authorization']).toBe('Bearer test-srk');
    });
  });

  describe('storage list', () => {
    it('rewrites path to /storage/v1/object/list/:bucket and normalizes body to flat prefix shape', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/platform/storage/testref/buckets/my-bucket/objects/list',
        headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
        payload: {
          path: 'images/',
          options: { limit: 20, offset: 0, search: '', sortBy: { column: 'name', order: 'asc' } },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.path).toBe('/storage/v1/object/list/my-bucket');
      expect(lastRequest!.method).toBe('POST');

      const body = JSON.parse(lastRequest!.body) as Record<string, unknown>;
      expect(body).toHaveProperty('prefix', 'images/');
      expect(body).toHaveProperty('limit', 20);
    });
  });

  describe('storage bucket-create', () => {
    it('backfills name from id in the upstream body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/platform/storage/testref/buckets',
        headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
        payload: { id: 'my-bucket', type: 'private', public: false },
      });

      expect(res.statusCode).toBe(200);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.path).toBe('/storage/v1/bucket');
      const body = JSON.parse(lastRequest!.body) as Record<string, unknown>;
      expect(body.name).toBe('my-bucket');
    });
  });

  describe('auth admin', () => {
    it('forwards GET /platform/auth/:ref/users to /auth/v1/admin/users with apikey + Authorization headers', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/platform/auth/testref/users',
        headers: { authorization: 'Bearer user-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(lastRequest).not.toBeNull();
      expect(lastRequest!.path).toBe('/auth/v1/admin/users');
      expect(lastRequest!.headers['apikey']).toBe('test-srk');
      expect(lastRequest!.headers['authorization']).toBe('Bearer test-srk');
    });
  });

  describe('analytics', () => {
    it('rewrites endpoints/<name> → endpoints/query/<name>, injects X-API-KEY, strips dashboard bearer', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/platform/projects/testref/analytics/endpoints/logs.all?sql=SELECT%201',
        headers: { authorization: 'Bearer user-token', apikey: 'anon-key' },
      });

      expect(res.statusCode).toBe(200);
      expect(lastRequest).not.toBeNull();
      // Logflare run-by-name route is endpoints/query/:name (probe: endpoints/<name> → 400);
      // self-hosted vector tags project="default", bound via the injected query param.
      expect(lastRequest!.path).toBe(
        '/analytics/v1/api/endpoints/query/logs.all?sql=SELECT%201&project=default',
      );
      expect(lastRequest!.path).not.toContain('endpoints/endpoints');
      // Logflare authenticates via X-API-KEY, not the forwarded dashboard bearer (probe: bearer-only → 401).
      expect(lastRequest!.headers['x-api-key']).toBe('test-lpat');
      expect(lastRequest!.headers['authorization']).toBeUndefined();
      expect(lastRequest!.headers['apikey']).toBeUndefined();
    });

    it('leaves endpoints/query/<name> unchanged (idempotent — lets the proxy be probed behind the stub)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/platform/projects/testref/analytics/endpoints/query/logs.all',
        headers: { authorization: 'Bearer user-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(lastRequest!.path).toBe('/analytics/v1/api/endpoints/query/logs.all?project=default');
      expect(lastRequest!.path).not.toContain('query/query');
      expect(lastRequest!.headers['x-api-key']).toBe('test-lpat');
    });

    it('degrades a Cloud-only metric endpoint upstream error to 200 {result:[]}', async () => {
      nextResponseStatus = 500; // self-hosted Logflare 500s on usage.api-counts (BigQuery dialect)
      nextResponseBody = '"Internal Server Error"';
      const res = await app.inject({
        method: 'GET',
        url: '/platform/projects/testref/analytics/endpoints/usage.api-counts',
        headers: { authorization: 'Bearer user-token' },
      });

      expect(lastRequest).not.toBeNull(); // it DID hit upstream
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ result: [] });
    });

    it('surfaces upstream errors for the real logs.all endpoint (no masking)', async () => {
      nextResponseStatus = 400; // e.g. user bad SQL in the Logs Explorer
      nextResponseBody = '{"error":"bad sql"}';
      const res = await app.inject({
        method: 'GET',
        url: '/platform/projects/testref/analytics/endpoints/logs.all?sql=BAD',
        headers: { authorization: 'Bearer user-token' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad sql' });
    });
  });
});
