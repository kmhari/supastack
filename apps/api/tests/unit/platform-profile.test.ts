import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}) }));

// Mutable membership set the db mock returns for the permissions query.
let memberships: { orgId: string }[] = [];

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: async () => memberships,
        innerJoin: () => ({ where: async () => [] }),
      }),
    }),
  }),
  schema: { organizationMembers: {}, organizations: {}, supabaseInstances: {}, users: {} },
}));

vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  loadMasterKey: () => Buffer.alloc(32),
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

async function buildApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );
  app.decorate('requireAuth', () => {
    if (!authed) throw Object.assign(new Error('unauthenticated'), { statusCode: 401 });
    return { id: 'u1', email: 'op@x.dev', role: 'owner' as const };
  });
  // Stub /v1/profile used by the platform profile delegation (feature 112)
  app.get('/v1/profile', async (_req, reply) => {
    if (!authed) return reply.status(401).send({ error: 'Unauthorized' });
    reply.send({ id: 'u1', primary_email: 'op@x.dev' });
  });
  await app.register(platformMiscRoutes);
  return app;
}

describe('GET /platform/profile (feature 084 — US1 bootstrap)', () => {
  it('happy: returns the operator profile with disabled_features', async () => {
    const app = await buildApp(true);
    const res = await app.inject({ method: 'GET', url: '/platform/profile' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.gotrue_id).toBe('u1');
    expect(body.primary_email).toBe('op@x.dev');
    expect(body.disabled_features).toContain('billing:invoices');
    expect(body.disabled_features).toContain('projects:transfer');
    // org/member/project create must NOT be disabled
    expect(body.disabled_features).not.toContain('organizations:create');
    await app.close();
  });

  it('sad: unauthenticated → 401', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: '/platform/profile' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('GET /platform/profile/permissions', () => {
  it('happy: one wildcard permission per org membership', async () => {
    memberships = [{ orgId: 'orgaaaaaaaaaaaaaaaaa' }, { orgId: 'orgbbbbbbbbbbbbbbbbb' }];
    const app = await buildApp(true);
    const res = await app.inject({ method: 'GET', url: '/platform/profile/permissions' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ organization_id: string; actions: string[] }>;
    expect(body).toHaveLength(2);
    expect(body[0]!.organization_id).toBe('orgaaaaaaaaaaaaaaaaa');
    expect(body[0]!.actions).toEqual(['%']);
    await app.close();
  });

  it('sad: zero-org operator → empty permission list', async () => {
    memberships = [];
    const app = await buildApp(true);
    const res = await app.inject({ method: 'GET', url: '/platform/profile/permissions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });
});
