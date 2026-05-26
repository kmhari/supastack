import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * T056 — route-level tests for GET /v1/projects/:ref/analytics/endpoints/logs.all.
 * Uses in-process Fastify; mocks logflare-client + project-store.
 */

const logflareMock = vi.hoisted(() => ({
  queryLogs: vi.fn(),
  AnalyticsUnreachableError: class AnalyticsUnreachableError extends Error {
    code = 'analytics_unreachable' as const;
  },
  AnalyticsBadGatewayError: class AnalyticsBadGatewayError extends Error {
    code = 'analytics_bad_gateway' as const;
  },
  InstanceNotFoundForLogsError: class InstanceNotFoundForLogsError extends Error {
    code = 'instance_not_found' as const;
  },
}));
vi.mock('../../src/services/logflare-client.js', () => logflareMock);

const projectStoreMock = vi.hoisted(() => ({ getProjectByRef: vi.fn() }));
vi.mock('../../src/services/project-store.js', () => projectStoreMock);

const { logsRoutes } = await import('../../src/routes/management/logs.js');
const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
const { AppError } = await import('@selfbase/shared');

const REF = 'aaaaaaaaaaaaaaaaaaaa';

async function buildApp(
  opts: { user?: { id: string; email: string; role: 'admin' | 'member' } | null; authorizeThrows?: boolean } = {},
): Promise<FastifyInstance> {
  const user = opts.user === undefined ? { id: 'u1', email: 'a@b.c', role: 'admin' as const } : opts.user;
  const app = Fastify();
  app.decorate('requireAuth', () => {
    if (!user) throw new AppError(401, 'unauthenticated', 'PAT required');
    return user;
  });
  app.decorate('authorize', () => {
    if (opts.authorizeThrows) throw new AppError(403, 'forbidden', 'admin role required');
  });
  await app.register(async (mgmt) => {
    await mgmt.register(mgmtApiErrorsPlugin);
    await mgmt.register(logsRoutes);
  }, { prefix: '/v1' });
  return app;
}

beforeEach(() => {
  logflareMock.queryLogs.mockReset();
  projectStoreMock.getProjectByRef.mockReset();
  projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF });
});

describe('GET /v1/projects/:ref/analytics/endpoints/logs.all', () => {
  it('happy path → 200 + { result: [...] }', async () => {
    logflareMock.queryLogs.mockResolvedValue([
      { timestamp: '2026-05-26T12:00:00Z', event_message: 'hello', metadata: { status: 200 } },
    ]);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/analytics/endpoints/logs.all?service=api`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result).toHaveLength(1);
    expect(body.result[0].event_message).toBe('hello');
  });

  it('invalid service → 400 invalid_params', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/analytics/endpoints/logs.all?service=not_a_real_service`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_params');
  });

  it('paused project → 409 project_not_runnable', async () => {
    logflareMock.queryLogs.mockRejectedValue(
      new logflareMock.AnalyticsUnreachableError("project status 'paused' — analytics not running"),
    );
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/analytics/endpoints/logs.all?service=api`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('project_not_runnable');
  });

  it('analytics unreachable → 503', async () => {
    logflareMock.queryLogs.mockRejectedValue(
      new logflareMock.AnalyticsUnreachableError('ECONNREFUSED'),
    );
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/analytics/endpoints/logs.all?service=api`,
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('analytics_unreachable');
  });

  it('analytics bad gateway → 502', async () => {
    logflareMock.queryLogs.mockRejectedValue(
      new logflareMock.AnalyticsBadGatewayError('bad JSON'),
    );
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/analytics/endpoints/logs.all?service=api`,
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('analytics_bad_gateway');
  });

  it('no auth → 401', async () => {
    const app = await buildApp({ user: null });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/analytics/endpoints/logs.all?service=api`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('member role lacking audit.read → 403', async () => {
    const app = await buildApp({ authorizeThrows: true });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/analytics/endpoints/logs.all?service=api`,
    });
    expect(res.statusCode).toBe(403);
  });

  it('unknown project ref → 404', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/analytics/endpoints/logs.all?service=api`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('verbatim sql param passes through to forwarder', async () => {
    logflareMock.queryLogs.mockResolvedValue([]);
    const app = await buildApp();
    await app.inject({
      method: 'GET',
      url: `/v1/projects/${REF}/analytics/endpoints/logs.all?sql=${encodeURIComponent('SELECT 1 FROM edge_logs')}`,
    });
    expect(logflareMock.queryLogs).toHaveBeenCalledWith(
      REF,
      expect.objectContaining({ sql: 'SELECT 1 FROM edge_logs' }),
    );
  });
});
