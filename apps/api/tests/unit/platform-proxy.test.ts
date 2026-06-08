import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const proxyHelpersMock = vi.hoisted(() => ({
  resolveInstance: vi.fn<(ref: string) => Promise<{ portKong: number }>>(),
  proxyToKong: vi.fn<
    (
      port: number,
      path: string,
      method: string,
      headers: Record<string, string | string[] | undefined>,
      body: Buffer | null,
    ) => Promise<{ status: number; headers: Record<string, string>; body: Buffer }>
  >(),
  ProxyProjectNotFoundError: class ProxyProjectNotFoundError extends Error {
    code = 'proxy_project_not_found' as const;
    constructor(ref: string) {
      super(`Project ${ref} not found`);
    }
  },
  ProxyProjectPausedError: class ProxyProjectPausedError extends Error {
    code = 'proxy_project_paused' as const;
    constructor(ref: string) {
      super(`Project ${ref} is paused`);
    }
  },
  ProxyUpstreamError: class ProxyUpstreamError extends Error {
    code = 'proxy_upstream_error' as const;
    status: number;
    constructor(message: string, status = 502) {
      super(message);
      this.status = status;
    }
  },
}));

vi.mock('../../src/services/platform-proxy-helpers.js', () => proxyHelpersMock);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildApp(authenticated = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', function requireAuth(_req: FastifyRequest) {
    if (!authenticated) {
      const err = new Error('Unauthorized') as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
    return { id: 'user-1', email: 'test@example.com', role: 'owner' as const };
  });
  const { platformProxyRoutes } = await import('../../src/routes/platform-proxy.js');
  await app.register(platformProxyRoutes);
  return app;
}

const MOCK_PORT = 54321;
const OK_RESPONSE = {
  status: 200,
  headers: { 'content-type': 'application/json' },
  body: Buffer.from(JSON.stringify([{ id: 'table1' }])),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('platform-proxy routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(true);
  });

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      const unauthApp = await buildApp(false);
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });

      const res = await unauthApp.inject({
        method: 'GET',
        url: '/platform/pg-meta/ref123/tables',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('pg-meta proxy', () => {
    it('proxies GET to Kong /pg-meta/v0/', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue(OK_RESPONSE);

      const res = await app.inject({
        method: 'GET',
        url: '/platform/pg-meta/ref123/tables?limit=10',
        headers: { authorization: 'Bearer token' },
      });

      expect(proxyHelpersMock.resolveInstance).toHaveBeenCalledWith('ref123');
      expect(proxyHelpersMock.proxyToKong).toHaveBeenCalledWith(
        MOCK_PORT,
        '/pg/tables?limit=10',
        'GET',
        expect.any(Object),
        expect.any(Buffer),
      );
      expect(res.statusCode).toBe(200);
    });

    it('does not forward x-connection-encrypted upstream', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue(OK_RESPONSE);

      await app.inject({
        method: 'GET',
        url: '/platform/pg-meta/ref123/tables',
        headers: {
          authorization: 'Bearer token',
          'x-connection-encrypted': 'postgresql://...',
        },
      });

      const [, , , forwardedHeaders] = proxyHelpersMock.proxyToKong.mock.calls[0]!;
      expect(forwardedHeaders).not.toHaveProperty('x-connection-encrypted');
    });

    it('strips upstream CORS headers from response', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
          'access-control-allow-credentials': 'true',
        },
        body: Buffer.from('[]'),
      });

      const res = await app.inject({
        method: 'GET',
        url: '/platform/pg-meta/ref123/tables',
        headers: { authorization: 'Bearer token' },
      });

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it('returns 404 for unknown project ref', async () => {
      proxyHelpersMock.resolveInstance.mockRejectedValue(
        new proxyHelpersMock.ProxyProjectNotFoundError('unknown'),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/platform/pg-meta/unknown/tables',
        headers: { authorization: 'Bearer token' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 503 for paused project', async () => {
      proxyHelpersMock.resolveInstance.mockRejectedValue(
        new proxyHelpersMock.ProxyProjectPausedError('paused-ref'),
      );

      const res = await app.inject({
        method: 'GET',
        url: '/platform/pg-meta/paused-ref/tables',
        headers: { authorization: 'Bearer token' },
      });

      expect(res.statusCode).toBe(503);
    });
  });

  describe('storage proxy', () => {
    it('rewrites list path and normalizes body for POST .../objects/list', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue(OK_RESPONSE);

      await app.inject({
        method: 'POST',
        url: '/platform/storage/ref123/buckets/test/objects/list',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        payload: {
          path: 'my-folder/',
          options: { limit: 20, offset: 5, search: 'img', sortBy: { column: 'size', order: 'desc' } },
        },
      });

      const call = proxyHelpersMock.proxyToKong.mock.calls.at(-1)!;
      // path must be rewritten to object/list/:bucket
      expect(call[1]).toBe('/storage/v1/object/list/test');
      // body must be normalized to flat storage-api shape
      const forwarded = JSON.parse((call[4] as Buffer).toString());
      expect(forwarded).toEqual({
        prefix: 'my-folder/',
        limit: 20,
        offset: 5,
        search: 'img',
        sortBy: { column: 'size', order: 'desc' },
      });
    });

    it('rewrites object download path: buckets/:b/objects/:key → object/:b/:key', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue(OK_RESPONSE);

      await app.inject({
        method: 'GET',
        url: '/platform/storage/ref123/buckets/test/objects/dir/file.jpg',
        headers: { authorization: 'Bearer token' },
      });

      expect(proxyHelpersMock.proxyToKong.mock.calls.at(-1)![1]).toBe(
        '/storage/v1/object/test/dir/file.jpg',
      );
    });

    it('proxies GET to Kong /storage/v1/', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue(OK_RESPONSE);

      await app.inject({
        method: 'GET',
        url: '/platform/storage/ref123/buckets',
        headers: { authorization: 'Bearer token' },
      });

      expect(proxyHelpersMock.proxyToKong).toHaveBeenCalledWith(
        MOCK_PORT,
        '/storage/v1/bucket',
        'GET',
        expect.any(Object),
        expect.any(Buffer),
      );
    });

    it('backfills name from id + forwards the full Studio bucket-create body', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue(OK_RESPONSE);

      // Exact STANDARD-bucket body Studio sends (apps/studio/data/storage/
      // bucket-create-mutation.ts: { id: values.name, type, public, file_size_limit?,
      // allowed_mime_types? } — no `name`; the upstream storage-api requires `name`).
      await app.inject({
        method: 'POST',
        url: '/platform/storage/ref123/buckets',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        payload: {
          id: 'test',
          type: 'STANDARD',
          public: true,
          file_size_limit: 26214400,
          allowed_mime_types: ['image/png'],
        },
      });

      const call = proxyHelpersMock.proxyToKong.mock.calls.at(-1)!;
      expect(call[1]).toBe('/storage/v1/bucket'); // path rewrite preserved
      const forwarded = JSON.parse((call[4] as Buffer).toString());
      expect(forwarded.name).toBe('test'); // ← fix: name backfilled from id (id IS the user's name)
      expect(forwarded.id).toBe('test');
      expect(forwarded.public).toBe(true);
      expect(forwarded.file_size_limit).toBe(26214400); // optional fields pass through verbatim
      expect(forwarded.allowed_mime_types).toEqual(['image/png']);
    });

    it('does NOT override an explicit name', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue(OK_RESPONSE);

      await app.inject({
        method: 'POST',
        url: '/platform/storage/ref123/buckets',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        payload: { id: 'an-id', name: 'explicit-name', public: false },
      });

      const forwarded = JSON.parse(
        (proxyHelpersMock.proxyToKong.mock.calls.at(-1)![4] as Buffer).toString(),
      );
      expect(forwarded.name).toBe('explicit-name');
    });
  });

  describe('auth admin proxy', () => {
    it('proxies GET users to Kong /auth/v1/admin/users', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue(OK_RESPONSE);

      await app.inject({
        method: 'GET',
        url: '/platform/auth/ref123/users',
        headers: { authorization: 'Bearer token' },
      });

      expect(proxyHelpersMock.proxyToKong).toHaveBeenCalledWith(
        MOCK_PORT,
        '/auth/v1/admin/users',
        'GET',
        expect.any(Object),
        expect.any(Buffer),
      );
    });

    it('proxies POST invite to /auth/v1/admin/users', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue({ ...OK_RESPONSE, status: 201 });

      await app.inject({
        method: 'POST',
        url: '/platform/auth/ref123/invite',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        payload: { email: 'test@example.com' },
      });

      expect(proxyHelpersMock.proxyToKong).toHaveBeenCalledWith(
        MOCK_PORT,
        '/auth/v1/admin/users',
        'POST',
        expect.any(Object),
        expect.any(Buffer),
      );
    });
  });

  describe('analytics proxy', () => {
    it('proxies GET to Kong /analytics/v1/', async () => {
      proxyHelpersMock.resolveInstance.mockResolvedValue({ portKong: MOCK_PORT });
      proxyHelpersMock.proxyToKong.mockResolvedValue(OK_RESPONSE);

      await app.inject({
        method: 'GET',
        url: '/platform/projects/ref123/analytics/endpoints/logs.all',
        headers: { authorization: 'Bearer token' },
      });

      expect(proxyHelpersMock.proxyToKong).toHaveBeenCalledWith(
        MOCK_PORT,
        '/analytics/v1/api/endpoints/logs.all',
        'GET',
        expect.any(Object),
        expect.any(Buffer),
      );
    });
  });
});
