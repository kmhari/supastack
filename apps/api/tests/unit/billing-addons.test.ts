import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

vi.mock('@selfbase/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ id: 'inst-1', ref: 'testrefabcdefghijkl' }],
        }),
      }),
    }),
  }),
  schema: { supabaseInstances: {}, users: {} },
}));

vi.mock('../../src/services/project-store.js', () => ({
  getProjectByRef: async (userId: string, ref: string) =>
    ref === 'testrefabcdefghijkl' ? { ref } : null,
}));

vi.mock('@selfbase/shared', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, logger: { warn: () => {}, info: () => {}, error: () => {} } };
});

const { billingAddonsRoutes } = await import('../../src/routes/management/billing-addons.js');
const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');

async function buildApp(authed = true) {
  const app = Fastify();
  await app.register(mgmtApiErrorsPlugin);
  app.decorateRequest('session', null);
  app.addHook('preHandler', (req, _reply, done) => {
    (req as unknown as Record<string, unknown>).session = authed
      ? { userId: '00000000-0000-0000-0000-000000000001' }
      : null;
    done();
  });
  // minimal requireAuth + authorize shims
  app.decorate('requireAuth', (req: { session: { userId: string } | null }) => {
    if (!req.session) throw new Error('Unauthorized');
    return { id: req.session.userId };
  });
  app.decorate('authorize', () => {});
  await app.register(billingAddonsRoutes, { prefix: '/v1' });
  return app;
}

describe('GET /v1/projects/:ref/billing/addons', () => {
  it('returns empty addon arrays for a valid project', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects/testrefabcdefghijkl/billing/addons',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.available_addons).toEqual([]);
    expect(body.selected_addons).toEqual([]);
  });

  it('returns 404 for unknown project ref', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects/unknownrefaaaaaaaaaa/billing/addons',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });
});
