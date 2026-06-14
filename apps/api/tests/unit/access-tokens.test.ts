import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
}));

const tokenRows = [
  {
    id: 'tok1',
    name: 'CLI token',
    tokenAlias: 'sbp_aaaaaaaa',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastUsedAt: null,
  },
];
let ownerRow: Array<{ userId: string }> = [{ userId: 'u1' }];

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => tokenRows,
          limit: async () => ownerRow,
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
  schema: {
    apiTokens: {},
    organizationMembers: {},
    organizations: {},
    supabaseInstances: {},
    users: {},
  },
}));

vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  loadMasterKey: () => Buffer.alloc(32),
}));

vi.mock('../../src/services/api-tokens.js', () => ({
  mintApiToken: async () => ({
    raw: `sbp_${'a'.repeat(40)}`,
    id: 'tok-new',
    prefix: 'sbp_aaaaaaaa',
  }),
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role: 'owner' as const }));
  await app.register(platformMiscRoutes);
  return app;
}

describe('/platform/profile/access-tokens (feature 084 US2 — PAT alias)', () => {
  it('happy: lists tokens in the AccessToken shape', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/platform/profile/access-tokens' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]!.name).toBe('CLI token');
    expect(body[0]!.token_alias).toBe('sbp_aaaaaaaa');
    expect(body[0]!.scope).toBe('V0');
    expect(body[0]!.last_used_at).toBeNull();
    await app.close();
  });

  it('happy: creates a token and returns the raw value once', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/platform/profile/access-tokens',
      payload: { name: 'My token' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.token).toMatch(/^sbp_[a-f0-9]{40}$/);
    expect(body.token_alias).toBe('sbp_aaaaaaaa');
    expect(body.scope).toBe('V0');
    await app.close();
  });

  it('happy: revokes own token → 204', async () => {
    ownerRow = [{ userId: 'u1' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/platform/profile/access-tokens/tok1' });
    expect(res.statusCode).toBe(204);
    await app.close();
  });

  it('sad: deleting another user’s token is a no-op 204 (own-only)', async () => {
    ownerRow = [{ userId: 'someone-else' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: '/platform/profile/access-tokens/tok1' });
    expect(res.statusCode).toBe(204);
    await app.close();
  });
});
