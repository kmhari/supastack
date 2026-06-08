/**
 * Unit tests for GET /v1/projects/:ref/types/typescript (US3 — feature 113)
 *
 * Mocks:
 *   - gen-types-service.js (generateTypes)
 *   - project-store.js     (getProjectByRef)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const projectStoreMock = vi.hoisted(() => ({
  getProjectByRef: vi.fn<(userId: string, ref: string) => Promise<Record<string, unknown> | null>>(),
}));

const genTypesMock = vi.hoisted(() => ({
  generateTypes: vi.fn<(inst: unknown, schemas: string[]) => Promise<string>>(),
  GenTypesError: class GenTypesError extends Error {
    constructor(
      public readonly code:
        | 'schema_not_found'
        | 'instance_not_running'
        | 'meta_upstream_error'
        | 'meta_unreachable',
      message: string,
      public readonly details?: Record<string, unknown>,
    ) {
      super(message);
      this.name = 'GenTypesError';
    }
  },
}));

vi.mock('../../src/services/project-store.js', () => projectStoreMock);
vi.mock('../../src/services/gen-types-service.js', () => genTypesMock);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FAKE_INST = { ref: 'ref123', status: 'running' };

async function buildApp(authenticated = true): Promise<FastifyInstance> {
  const app = Fastify();
  const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
  const { AppError } = await import('@supastack/shared');
  await app.register(mgmtApiErrorsPlugin);
  app.decorate('requireAuth', (_req: FastifyRequest) => {
    if (!authenticated) throw new AppError(401, 'unauthenticated', 'Unauthorized');
    return { id: 'user-1', email: 'test@example.com', role: 'owner' as const };
  });
  app.decorate('authorize', () => {});
  const { genTypesRoutes } = await import('../../src/routes/management/gen-types.js');
  await app.register(fp(async (scope) => { await scope.register(genTypesRoutes); }));
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /projects/:ref/types/typescript', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('200 — generateTypes resolves → returns { types: <string> }', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    genTypesMock.generateTypes.mockResolvedValue('export type Database = {}');

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/types/typescript',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ types: 'export type Database = {}' });
  });

  it('404 — project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/projects/unknown/types/typescript',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({
      method: 'GET',
      url: '/projects/ref123/types/typescript',
    });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });

  it('400 — schema_not_found GenTypesError', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    genTypesMock.generateTypes.mockRejectedValue(
      new genTypesMock.GenTypesError('schema_not_found', 'Schema "foo" not found'),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/types/typescript?included_schemas=foo',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'schema_not_found' });
  });

  it('409 — instance_not_running GenTypesError', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    genTypesMock.generateTypes.mockRejectedValue(
      new genTypesMock.GenTypesError('instance_not_running', 'Project is not running'),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/types/typescript',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'project_not_running' });
  });

  it('502 — meta_unreachable GenTypesError', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    genTypesMock.generateTypes.mockRejectedValue(
      new genTypesMock.GenTypesError('meta_unreachable', 'pg-meta unreachable'),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/types/typescript',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ code: 'pg_meta_unreachable' });
  });
});
