import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * T063 — route-level tests for GET /v1/projects/:ref/storage/buckets.
 */

const proxyMock = vi.hoisted(() => ({
  listBuckets: vi.fn(),
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
vi.mock('@selfbase/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ status: dbStatus.value }],
        }),
      }),
    }),
  }),
  schema: { supabaseInstances: { ref: 'ref', status: 'status' } },
}));

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

const { storageBucketsRoutes } = await import('../../src/routes/management/storage-buckets.js');
const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
const { AppError } = await import('@selfbase/shared');

const REF = 'bbbbbbbbbbbbbbbbbbbb';

async function buildApp(opts: { user?: { id: string; email: string; role: 'admin' | 'member' } | null } = {}): Promise<FastifyInstance> {
  const user = opts.user === undefined ? { id: 'u1', email: 'a@b.c', role: 'member' as const } : opts.user;
  const app = Fastify();
  app.decorate('requireAuth', () => {
    if (!user) throw new AppError(401, 'unauthenticated', 'PAT required');
    return user;
  });
  app.decorate('authorize', () => {}); // instance.read is allowed for members
  await app.register(async (mgmt) => {
    await mgmt.register(mgmtApiErrorsPlugin);
    await mgmt.register(storageBucketsRoutes);
  }, { prefix: '/v1' });
  return app;
}

beforeEach(() => {
  proxyMock.listBuckets.mockReset();
  projectStoreMock.getProjectByRef.mockReset();
  projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF });
  dbStatus.value = 'running';
});

describe('GET /v1/projects/:ref/storage/buckets', () => {
  it('happy path → 200 + bare-array of buckets', async () => {
    proxyMock.listBuckets.mockResolvedValue([
      { id: 'avatars', name: 'avatars', public: true, file_size_limit: 5242880, allowed_mime_types: ['image/png'], created_at: 'x', updated_at: 'y' },
      { id: 'private', name: 'private', public: false, file_size_limit: null, allowed_mime_types: null, created_at: 'x', updated_at: 'y' },
    ]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/v1/projects/${REF}/storage/buckets` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('avatars');
  });

  it('empty buckets → 200 + []', async () => {
    proxyMock.listBuckets.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/v1/projects/${REF}/storage/buckets` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('paused project → 409 project_not_runnable', async () => {
    dbStatus.value = 'paused';
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/v1/projects/${REF}/storage/buckets` });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('project_not_runnable');
  });

  it('storage unreachable → 503', async () => {
    proxyMock.listBuckets.mockRejectedValue(new proxyMock.StorageUnreachableError('ECONNREFUSED'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/v1/projects/${REF}/storage/buckets` });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('storage_unreachable');
  });

  it('storage bad gateway → 502', async () => {
    proxyMock.listBuckets.mockRejectedValue(new proxyMock.StorageBadGatewayError('bad JSON'));
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/v1/projects/${REF}/storage/buckets` });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('storage_bad_gateway');
  });

  it('no auth → 401', async () => {
    const app = await buildApp({ user: null });
    const res = await app.inject({ method: 'GET', url: `/v1/projects/${REF}/storage/buckets` });
    expect(res.statusCode).toBe(401);
  });

  it('member role with instance.read allowed → 200 (read-only is fine for members)', async () => {
    proxyMock.listBuckets.mockResolvedValue([]);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/v1/projects/${REF}/storage/buckets` });
    expect(res.statusCode).toBe(200);
  });

  it('unknown project ref → 404', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/v1/projects/${REF}/storage/buckets` });
    expect(res.statusCode).toBe(404);
  });
});
