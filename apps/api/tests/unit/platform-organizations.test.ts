import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('drizzle-orm', () => ({ and: () => ({}), desc: () => ({}), eq: () => ({}), isNull: () => ({}) }));

// Configurable result for `select().from().where().limit()` (org reselect / project check).
let limitResult: unknown[] = [];

vi.mock('@supastack/db', () => ({
  db: () => ({
    transaction: async (cb: (tx: unknown) => unknown) =>
      cb({ insert: () => ({ values: async () => undefined, onConflictDoNothing: () => ({}) }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: async () => limitResult }) }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  }),
  schema: {
    organizations: {},
    organizationMembers: {},
    supabaseInstances: {},
    organizationInvitations: {},
    users: {},
  },
}));

vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  loadMasterKey: () => Buffer.alloc(32),
  generateRef: () => 'abcdefghijklmnopqrst',
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

async function buildApp(role: 'owner' | 'administrator' | 'developer' | 'read_only' = 'owner') {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role }));
  app.decorate('authorizeOrg', async () => role);
  await app.register(platformMiscRoutes);
  return app as FastifyInstance;
}

describe('Organizations CRUD (feature 084 US3)', () => {
  it('happy: create returns a 20-char ref id + name', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/platform/organizations',
      payload: { name: 'Acme' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toMatch(/^[a-z]{20}$/);
    expect(body.slug).toBe(body.id);
    expect(body.name).toBe('Acme');
    expect(body.pending_payment_intent_secret).toBeNull();
    await app.close();
  });

  it('sad: create with blank name → 400', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/platform/organizations', payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('happy: rename → 200', async () => {
    limitResult = [{ id: 'abcdefghijklmnopqrst', name: 'Renamed' }];
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/platform/organizations/abcdefghijklmnopqrst',
      payload: { name: 'Renamed' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Renamed');
    await app.close();
  });

  it('happy: delete an empty org → 204', async () => {
    limitResult = []; // no projects
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/platform/organizations/abcdefghijklmnopqrst' });
    expect(res.statusCode).toBe(204);
    await app.close();
  });

  it('sad: delete an org that still owns projects → 409', async () => {
    limitResult = [{ ref: 'projaaaaaaaaaaaaaaaa' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/platform/organizations/abcdefghijklmnopqrst' });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
