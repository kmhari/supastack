import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const proxyMock = vi.hoisted(() => ({
  listBuckets: vi.fn(),
  createBucket: vi.fn(),
  getBucket: vi.fn(),
  updateBucket: vi.fn(),
  deleteBucket: vi.fn(),
  emptyBucket: vi.fn(),
  StorageUnreachableError: class StorageUnreachableError extends Error {
    code = 'storage_unreachable' as const;
  },
  StorageBadGatewayError: class StorageBadGatewayError extends Error {
    code = 'storage_bad_gateway' as const;
  },
}));
vi.mock('../../src/services/storage-buckets-proxy.js', () => proxyMock);

const serviceRoleMock = vi.hoisted(() => ({
  mintServiceRoleJwt: vi.fn(),
  InstanceNotFoundForServiceRoleError: class InstanceNotFoundForServiceRoleError extends Error {
    code = 'instance_not_found' as const;
  },
  _clearServiceRoleCache: () => {},
}));
vi.mock('../../src/services/service-role-jwt.js', () => serviceRoleMock);

const projectStoreMock = vi.hoisted(() => ({ getProjectByRef: vi.fn() }));
vi.mock('../../src/services/project-store.js', () => projectStoreMock);

const dbStatus = { value: 'running' as string };
vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (dbStatus.value ? [{ status: dbStatus.value, portKong: 30006 }] : []),
        }),
      }),
    }),
  }),
  schema: { supabaseInstances: { ref: 'ref', status: 'status', portKong: 'pk' } },
}));

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

const { storageBucketsRoutes } = await import('../../src/routes/management/storage-buckets.js');
const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
const { AppError } = await import('@supastack/shared');

const REF = 'bbbbbbbbbbbbbbbbbbbb';

async function buildApp(authed = true): Promise<FastifyInstance> {
  const user = authed ? { id: 'u1', email: 'a@b.c', role: 'owner' as const } : null;
  const app = Fastify();
  app.decorate('requireAuth', () => {
    if (!user) throw new AppError(401, 'unauthenticated', 'PAT required');
    return user;
  });
  app.decorate('authorize', () => {});
  await app.register(
    async (mgmt) => {
      await mgmt.register(mgmtApiErrorsPlugin);
      await mgmt.register(storageBucketsRoutes);
    },
    { prefix: '/v1' },
  );
  return app;
}

beforeEach(() => {
  proxyMock.listBuckets.mockReset();
  proxyMock.createBucket.mockReset();
  proxyMock.getBucket.mockReset();
  proxyMock.updateBucket.mockReset();
  proxyMock.deleteBucket.mockReset();
  proxyMock.emptyBucket.mockReset();
  projectStoreMock.getProjectByRef.mockReset();
  projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF });
  dbStatus.value = 'running';
});

// ── POST /v1/projects/:ref/storage/buckets ────────────────────────────────────

describe('POST /v1/projects/:ref/storage/buckets', () => {
  it('happy path with name → 200 with bucket object', async () => {
    proxyMock.createBucket.mockResolvedValue({ id: 'my-bucket', name: 'my-bucket', public: false });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${REF}/storage/buckets`,
      payload: { name: 'my-bucket' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('my-bucket');
    await app.close();
  });

  it('body with id only (Studio shape) → route calls createBucket and returns 200', async () => {
    proxyMock.createBucket.mockResolvedValue({ id: 'bucket-id', name: 'bucket-id', public: false });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${REF}/storage/buckets`,
      payload: { id: 'bucket-id' },
    });
    expect(res.statusCode).toBe(200);
    expect(proxyMock.createBucket).toHaveBeenCalledOnce();
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${REF}/storage/buckets`,
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('proxy throws → 500', async () => {
    proxyMock.createBucket.mockRejectedValue(new Error('storage down'));
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${REF}/storage/buckets`,
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

// ── GET /v1/projects/:ref/storage/buckets/:id ─────────────────────────────────

describe('GET /v1/projects/:ref/storage/buckets/:id', () => {
  it('happy path → 200 with bucket shape', async () => {
    proxyMock.getBucket.mockResolvedValue({ id: 'b1', name: 'b1', public: false });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/storage/buckets/b1`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe('b1');
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/storage/buckets/b1`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('proxy throws StorageUnreachableError → 503', async () => {
    proxyMock.getBucket.mockRejectedValue(new proxyMock.StorageUnreachableError('not found'));
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/storage/buckets/b1`,
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

// ── PATCH /v1/projects/:ref/storage/buckets/:id ───────────────────────────────

describe('PATCH /v1/projects/:ref/storage/buckets/:id', () => {
  it('happy path → 200 with updated shape', async () => {
    proxyMock.updateBucket.mockResolvedValue({ id: 'b1', name: 'b1', public: true });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${REF}/storage/buckets/b1`,
      payload: { public: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().public).toBe(true);
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${REF}/storage/buckets/b1`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('proxy throws → 500', async () => {
    proxyMock.updateBucket.mockRejectedValue(new Error('storage error'));
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${REF}/storage/buckets/b1`,
      payload: {},
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});

// ── DELETE /v1/projects/:ref/storage/buckets/:id ──────────────────────────────

describe('DELETE /v1/projects/:ref/storage/buckets/:id', () => {
  it('happy path → 200', async () => {
    proxyMock.emptyBucket.mockResolvedValue({});
    proxyMock.deleteBucket.mockResolvedValue({ message: 'bucket deleted' });
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${REF}/storage/buckets/b1`,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${REF}/storage/buckets/b1`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('proxy throws → 500', async () => {
    proxyMock.emptyBucket.mockResolvedValue({});
    proxyMock.deleteBucket.mockRejectedValue(new Error('delete failed'));
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${REF}/storage/buckets/b1`,
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
