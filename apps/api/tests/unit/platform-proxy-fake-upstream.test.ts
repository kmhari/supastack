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
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify([]));
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
  const real = await importOriginal<typeof import('../../src/services/platform-proxy-helpers.js')>();
  return {
    ...real,
    resolveInstance: vi.fn().mockResolvedValue({
      portKong: 0,
      serviceRoleKey: 'test-srk',
      dashboardPassword: 'test-dp',
    }),
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
        payload: { path: 'images/', options: { limit: 20, offset: 0, search: '', sortBy: { column: 'name', order: 'asc' } } },
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
    it('upstream path is /analytics/v1/api/endpoints/logs.all (not doubled)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/platform/projects/testref/analytics/endpoints/logs.all',
        headers: { authorization: 'Bearer user-token' },
      });

      expect(res.statusCode).toBe(200);
      expect(lastRequest).not.toBeNull();
      // Guards the feature 112 regression: prefix is /analytics/v1/api/ + wildcard endpoints/logs.all
      // → must NOT become /analytics/v1/api/endpoints/endpoints/logs.all
      expect(lastRequest!.path).toBe('/analytics/v1/api/endpoints/logs.all');
      expect(lastRequest!.path).not.toContain('endpoints/endpoints');
    });
  });
});
