import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('drizzle-orm', () => ({ and: () => ({}), desc: () => ({}), eq: () => ({}), isNull: () => ({}), sql: () => ({}) }));

let instances: unknown[] = [];
let countRows: { count: number }[] = [{ count: 0 }];

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        // count query awaits where(); instances query chains .limit().offset()
        where: () => ({
          limit: () => ({ offset: async () => instances }),
          then: (resolve: (v: unknown) => void) => resolve(countRows),
        }),
      }),
    }),
  }),
  schema: { supabaseInstances: {}, organizationMembers: {}, organizations: {}, organizationInvitations: {}, users: {} },
}));

vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  loadMasterKey: () => Buffer.alloc(32),
  generateRef: () => 'abcdefghijklmnopqrst',
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

async function buildApp(member = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role: 'developer' as const }));
  app.decorate('authorizeOrg', async () => {
    if (!member) throw Object.assign(new Error('not a member'), { statusCode: 403 });
    return 'developer' as const;
  });
  await app.register(platformMiscRoutes);
  return app;
}

const SLUG = 'abcdefghijklmnopqrst';

describe('GET /platform/organizations/:slug/projects (feature 084 US5)', () => {
  it('happy: paginated, returns the org total count', async () => {
    instances = [
      {
        ref: 'projaaaaaaaaaaaaaaaa',
        name: 'P1',
        status: 'running',
        portKong: 30000,
        insertedAt: new Date(),
        updatedAt: new Date(),
        orgId: SLUG,
      },
    ];
    countRows = [{ count: 1 }];
    const app = await buildApp(true);
    const res = await app.inject({ method: 'GET', url: `/platform/organizations/${SLUG}/projects?limit=10&offset=0` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pagination.count).toBe(1);
    expect(body.pagination.limit).toBe(10);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].ref).toBe('projaaaaaaaaaaaaaaaa');
    await app.close();
  });

  it('sad: a non-member of the org → 403', async () => {
    const app = await buildApp(false);
    const res = await app.inject({ method: 'GET', url: `/platform/organizations/${SLUG}/projects` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});
