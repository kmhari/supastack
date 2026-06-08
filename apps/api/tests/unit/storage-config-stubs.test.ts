/**
 * Feature 114 — storage platform API stub/alias endpoints (SC-004).
 *
 * Covers all 11 endpoints under /platform/projects/:ref/storage/* with happy +
 * sad (401) paths. Harness mirrors platform-misc-routes.test.ts: mock the heavy
 * platform-misc deps, decorate auth, register platformMiscRoutes.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

vi.mock('../../src/services/project-store.js', () => ({
  getProjectByRef: vi.fn(),
  getPlaintextConfig: vi.fn(),
}));
vi.mock('../../src/services/runtime-config-store.js', () => ({
  getConfig: vi.fn(),
  getPlaintextConfig: vi.fn(),
  saveConfigOnly: vi.fn(),
  patchConfig: vi.fn(),
}));
vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
  isNull: () => ({}),
  sql: () => ({}),
}));
vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: async () => [] }) }),
        where: () => ({ limit: async () => [] }),
      }),
    }),
    insert: () => ({ values: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  }),
  schema: {
    supabaseInstances: {},
    organizationMembers: {},
    organizations: {},
    apiTokens: {},
    auditLog: {},
    projectConfigSnapshots: {},
  },
}));
vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  encryptJson: () => Buffer.alloc(0),
  loadMasterKey: () => Buffer.alloc(32),
  generateRef: () => 'abcdefghijklmnopqrst',
  signSupabaseJwt: () => 'jwt',
}));
vi.mock('../../src/services/api-tokens.js', () => ({
  mintApiToken: async () => ({ raw: `sbp_${'a'.repeat(40)}`, id: 'tok', prefix: 'sbp_aaaa' }),
}));

async function buildApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );
  app.decorate('requireAuth', (_req: FastifyRequest) => {
    if (!authed) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    return { id: 'u1', email: 'op@x.dev', role: 'owner' as const };
  });
  app.decorate('authorize', () => {});
  app.decorate('authorizeOrg', async () => 'owner' as const);
  const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');
  await app.register(platformMiscRoutes);
  return app;
}

const REF = 'abcdefghijklmnopqrst';
const base = `/platform/projects/${REF}/storage`;

describe('US1 — /storage/config aliases', () => {
  it('GET returns the StorageConfigResponse shape (features.s3Protocol.enabled present)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `${base}/config` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.features.s3Protocol.enabled).toBe(true);
    expect(body.features.imageTransformation.enabled).toBe(true);
    expect(body.fileSizeLimit).toBe(52428800);
    await app.close();
  });
  it('PATCH merges + returns the updated config', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `${base}/config`,
      payload: { fileSizeLimit: 100 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().fileSizeLimit).toBe(100);
    expect(res.json().features.s3Protocol.enabled).toBe(true); // untouched slice preserved
    await app.close();
  });
});

describe('US2 — image-transformations slice', () => {
  it('GET returns { enabled } from the imageTransformation slice', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `${base}/config/image-transformations` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true });
    await app.close();
  });
  it('PATCH { enabled: false } returns { enabled: false }', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `${base}/config/image-transformations`,
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: false });
    await app.close();
  });
});

describe('US3 — S3 connection (no-op)', () => {
  it('GET → 200 object', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `${base}/config/s3-connection` });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json()).toBe('object');
    await app.close();
  });
  it('POST → 200', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `${base}/config/s3-connection`, payload: {} });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
  it('DELETE → 204', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `${base}/config/s3-connection` });
    expect(res.statusCode).toBe(204);
    await app.close();
  });
});

describe('US4 — S3 connection credentials (no-op)', () => {
  it('POST → 200', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `${base}/config/s3-connection/credentials`,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
  it('DELETE → 204', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `${base}/config/s3-connection/credentials`,
    });
    expect(res.statusCode).toBe(204);
    await app.close();
  });
});

describe('US5 — bulk bucket ops (no-op)', () => {
  it('PATCH → 200 {}', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'PATCH', url: `${base}/buckets`, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({});
    await app.close();
  });
  it('DELETE → 204', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: `${base}/buckets` });
    expect(res.statusCode).toBe(204);
    await app.close();
  });
});

describe('sad path — all 11 endpoints require auth (401)', () => {
  const cases: Array<[string, string]> = [
    ['GET', `${base}/config`],
    ['PATCH', `${base}/config`],
    ['GET', `${base}/config/image-transformations`],
    ['PATCH', `${base}/config/image-transformations`],
    ['GET', `${base}/config/s3-connection`],
    ['POST', `${base}/config/s3-connection`],
    ['DELETE', `${base}/config/s3-connection`],
    ['POST', `${base}/config/s3-connection/credentials`],
    ['DELETE', `${base}/config/s3-connection/credentials`],
    ['PATCH', `${base}/buckets`],
    ['DELETE', `${base}/buckets`],
  ];
  it.each(cases)('%s %s → 401 when unauthenticated', async (method, url) => {
    const app = await buildApp(false);
    const res = await app.inject({ method: method as 'GET', url, payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
