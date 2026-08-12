import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
}));

let queryRows: unknown[] = [];
const deletedInvites: string[] = [];
vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: async () => queryRows }),
        where: async () => queryRows,
      }),
    }),
    // `.values()` is both awaitable (plain inserts) and chainable into
    // `.returning()` (the invite path needs the row id to roll back by hand).
    insert: () => ({ values: () => ({ returning: async () => [{ id: 'inv1' }] }) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => deletedInvites.push('inv1') }),
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

// Accounts are created through GoTrue's admin invite; the route must call it
// for every invitee, because with open signup removed this is the only way an
// invitee can ever authenticate to accept.
const invitedEmails: string[] = [];
let mockInviteError: { statusCode?: number } | null = null;
vi.mock('../../src/services/gotrue-admin.js', () => ({
  inviteGotrueUser: async ({ email }: { email: string }) => {
    if (mockInviteError) throw Object.assign(new Error('invite failed'), mockInviteError);
    invitedEmails.push(email);
    return { id: 'g1', email };
  },
  sendRecoveryEmail: async () => undefined,
  updateGotrueUser: async () => ({ id: 'g1', email: 'x@y.z' }),
}));

let mockMemberRole: string | null = 'owner';
let mockOwnerCount = 1;
vi.mock('../../src/services/org-membership.js', () => ({
  memberRole: async () => mockMemberRole,
  ownerCount: async () => mockOwnerCount,
  newInviteToken: () => ({
    raw: 'tok',
    sha256: Buffer.alloc(32),
    expiresAt: new Date(Date.now() + 3.6e6),
  }),
  hashInviteToken: () => Buffer.alloc(32),
}));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

async function buildApp() {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role: 'owner' as const }));
  app.decorate('authorizeOrg', async () => 'owner' as const);
  await app.register(platformMiscRoutes);
  return app as FastifyInstance;
}

const SLUG = 'abcdefghijklmnopqrst';

describe('Org roles + members + invitations (feature 084 US4)', () => {
  it('roles: returns the four numeric-id role objects', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/organizations/${SLUG}/roles` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.org_scoped_roles.map((r: { id: number }) => r.id)).toEqual([1, 2, 3, 4]);
    expect(body.org_scoped_roles[0].name).toBe('Owner');
    expect(body.project_scoped_roles).toEqual([]);
    await app.close();
  });

  it('members: maps role → role_ids', async () => {
    queryRows = [{ gotrueId: 'm1', role: 'developer', email: 'dev@x.dev' }];
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/organizations/${SLUG}/members` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body[0].gotrue_id).toBe('m1');
    expect(body[0].role_ids).toEqual([3]);
    await app.close();
  });

  it('invite: emails[] + role_id → {succeeded, failed}', async () => {
    process.env.GOTRUE_SMTP_HOST = 'smtp.test';
    invitedEmails.length = 0;
    mockInviteError = null;
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/organizations/${SLUG}/members/invitations`,
      payload: { emails: ['dev@x.dev'], role_id: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().succeeded).toEqual(['dev@x.dev']);
    // Without this the invitee has no account and can never accept.
    expect(invitedEmails).toEqual(['dev@x.dev']);
    await app.close();
  });

  it('invite: an already-registered invitee (GoTrue 422) still succeeds', async () => {
    process.env.GOTRUE_SMTP_HOST = 'smtp.test';
    deletedInvites.length = 0;
    mockInviteError = { statusCode: 422 };
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/organizations/${SLUG}/members/invitations`,
      payload: { emails: ['existing@x.dev'], role_id: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().succeeded).toEqual(['existing@x.dev']);
    // They already have credentials, so the invite stands — nothing rolled back.
    expect(deletedInvites).toEqual([]);
    mockInviteError = null;
    await app.close();
  });

  it('sad: GoTrue send failure reports failed AND rolls the invite row back', async () => {
    process.env.GOTRUE_SMTP_HOST = 'smtp.test';
    deletedInvites.length = 0;
    mockInviteError = { statusCode: 500 };
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/organizations/${SLUG}/members/invitations`,
      payload: { emails: ['dev@x.dev'], role_id: 3 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().succeeded).toEqual([]);
    expect(res.json().failed[0].email).toBe('dev@x.dev');
    // Otherwise a pending invite lingers that the operator was told had failed.
    expect(deletedInvites).toEqual(['inv1']);
    mockInviteError = null;
    await app.close();
  });

  it('invite: invalid role_id → 400', async () => {
    process.env.GOTRUE_SMTP_HOST = 'smtp.test';
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/organizations/${SLUG}/members/invitations`,
      payload: { emails: ['x@y.z'], role_id: 99 },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('sad: invite when SMTP is not configured → 409 (US6)', async () => {
    delete process.env.GOTRUE_SMTP_HOST;
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/organizations/${SLUG}/members/invitations`,
      payload: { emails: ['dev@x.dev'], role_id: 3 },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('sad: demoting the last owner → 409', async () => {
    mockMemberRole = 'owner';
    mockOwnerCount = 1;
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/platform/organizations/${SLUG}/members/m1`,
      payload: { role_id: 4 },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('sad: removing the last owner → 409', async () => {
    mockMemberRole = 'owner';
    mockOwnerCount = 1;
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/platform/organizations/${SLUG}/members/m1`,
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('happy: removing a non-owner member → 204', async () => {
    mockMemberRole = 'developer';
    mockOwnerCount = 1;
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/platform/organizations/${SLUG}/members/m1`,
    });
    expect(res.statusCode).toBe(204);
    await app.close();
  });
});
