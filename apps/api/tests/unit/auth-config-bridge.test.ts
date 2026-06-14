import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Bridge: GET/PATCH /platform/auth/:ref/config translate Studio UPPERCASE ↔ /v1
// lowercase (feature 085). The bridge re-injects to /v1/projects/:ref/config/auth,
// so we register a stub /v1 handler that emulates the strict-lowercase mgmt schema
// + the {message,code,details} error envelope. The real translation module is used.

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
  sql: () => ({}),
}));
vi.mock('@supastack/db', () => ({
  db: () => ({}),
  schema: {
    supabaseInstances: {},
    organizationMembers: {},
    organizations: {},
    organizationInvitations: {},
    authUsers: {},
    users: {},
    apiTokens: {},
    installation: {},
  },
}));
vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  loadMasterKey: () => Buffer.alloc(32),
  generateRef: () => 'abcdefghijklmnopqrst',
}));
// NOTE: @supastack/shared is NOT mocked — the translation needs the real ALL_AUTH_CONFIG_FIELDS.

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

const patches: Array<Record<string, unknown>> = [];

async function buildApp(opts: { notRunning?: boolean } = {}): Promise<FastifyInstance> {
  patches.length = 0;
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role: 'developer' as const }));
  app.decorate('authorizeOrg', async () => 'developer' as const);
  app.decorate('authorize', () => {});
  // Stub the /v1 mgmt auth-config the bridge re-injects to.
  app.get('/v1/projects/:ref/config/auth', async (_req, reply) =>
    reply.send({
      external_github_enabled: true,
      site_url: 'https://saved.test',
      _supastack: { fieldStatus: { external_github_enabled: { status: 'honored' } } },
    }),
  );
  app.patch('/v1/projects/:ref/config/auth', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    patches.push(body);
    if (opts.notRunning)
      return reply
        .status(409)
        .send({ message: 'project not running', code: 'project_not_running' });
    // strict lowercase: any non-lowercase key is unknown
    const unknown = Object.keys(body).filter((k) => k !== '_supastack' && k !== k.toLowerCase());
    if (unknown.length) {
      return reply.status(400).send({
        message: 'Validation failed',
        code: 'validation_failed',
        details: Object.fromEntries(unknown.map((k) => [k, 'unknown_field'])),
      });
    }
    return reply.send({ ...body });
  });
  await app.register(platformMiscRoutes);
  return app;
}

const REF = 'tbnqljlgozpxzhkjxats';

describe('PATCH /platform/auth/:ref/config (US1)', () => {
  it('happy: the reported uppercase GitHub payload → 200, and /v1 receives LOWERCASE keys', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/platform/auth/${REF}/config`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: {
        EXTERNAL_GITHUB_ENABLED: true,
        EXTERNAL_GITHUB_CLIENT_ID: 'id',
        EXTERNAL_GITHUB_SECRET: 'sec',
        EXTERNAL_GITHUB_EMAIL_OPTIONAL: false,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(patches[0]).toEqual({
      external_github_enabled: true,
      external_github_client_id: 'id',
      external_github_secret: 'sec',
      external_github_email_optional: false,
    });
    await app.close();
  });

  it('happy: a non-OAuth uppercase field (SITE_URL) → 200, lowercased downstream', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/platform/auth/${REF}/config`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { SITE_URL: 'https://x.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(patches[0]).toEqual({ site_url: 'https://x.test' }); // partial preserved, only this key
    await app.close();
  });

  it('sad: project not running → 409 (not a generic 500)', async () => {
    const app = await buildApp({ notRunning: true });
    const res = await app.inject({
      method: 'PATCH',
      url: `/platform/auth/${REF}/config`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { SITE_URL: 'x' },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});

describe('GET /platform/auth/:ref/config (US2)', () => {
  it('happy: returns UPPERCASE keys; _supastack meta untouched', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/auth/${REF}/config`,
      headers: { authorization: 'Bearer x' },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.EXTERNAL_GITHUB_ENABLED).toBe(true);
    expect(b.SITE_URL).toBe('https://saved.test');
    expect(b.external_github_enabled).toBeUndefined(); // not lowercase anymore
    expect(b._supastack).toEqual({
      fieldStatus: { external_github_enabled: { status: 'honored' } },
    }); // NOT upper-cased
    await app.close();
  });
});

describe('PATCH /platform/auth/:ref/config error surfacing (US3)', () => {
  it('sad: an unknown field → 400 with the field named in UPPERCASE details (not 500 internal)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/platform/auth/${REF}/config`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { NONSENSE_FIELD_XYZ: 1 },
    });
    expect(res.statusCode).toBe(400);
    const b = res.json();
    expect(b.code).toBe('validation_failed');
    expect(b.details).toHaveProperty('NONSENSE_FIELD_XYZ', 'unknown_field'); // uppercase, naming the field
    expect(b.code).not.toBe('internal');
    await app.close();
  });
});
