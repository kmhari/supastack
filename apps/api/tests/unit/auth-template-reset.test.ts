/**
 * POST /platform/auth/:ref/templates/:template/reset  ("Reset to default")
 * POST /platform/auth/:ref/validate/spam              (spam-score preview)
 *
 * Both are Studio call sites that previously hit nothing. Same harness as
 * auth-config-bridge.test.ts: a stub /v1 auth-config handler stands in for the
 * management surface the reset re-injects to, and the REAL case-translation
 * module runs so a casing regression fails here rather than in the browser.
 */
import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

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
  db: () => ({}),
  schema: {
    supabaseInstances: {},
    organizationMembers: {},
    organizations: {},
    organizationInvitations: {},
    authUsers: {},
    users: {},
    apiTokens: {},
    auditLog: {},
    installation: {},
  },
}));
vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  loadMasterKey: () => Buffer.alloc(32),
  generateRef: () => 'abcdefghijklmnopqrst',
}));
vi.mock('bullmq', () => ({ Queue: class {} }));
vi.mock('ioredis', () => ({ Redis: class {} }));
// @supastack/shared stays REAL — the translation needs ALL_AUTH_CONFIG_FIELDS.

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

const patches: Array<Record<string, unknown>> = [];

async function buildApp(opts: { notRunning?: boolean } = {}): Promise<FastifyInstance> {
  patches.length = 0;
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role: 'developer' as const }));
  app.decorate('authorizeOrg', async () => 'developer' as const);
  app.decorate('authorize', () => {});
  app.patch('/v1/projects/:ref/config/auth', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    patches.push(body);
    if (opts.notRunning) {
      return reply
        .status(409)
        .send({ message: 'project not running', code: 'project_not_running' });
    }
    // Echo a fuller config back: the reset response is written straight into
    // Studio's authConfig cache, so a partial echo would blank the form.
    return reply.send({ site_url: 'https://saved.test', ...body });
  });
  await app.register(platformMiscRoutes);
  return app;
}

const REF = 'tbnqljlgozpxzhkjxats';
const AUTH = { authorization: 'Bearer x', 'content-type': 'application/json' };
// The reset takes no request body (upstream declares `requestBody?: never`) and
// openapi-fetch only sets Content-Type when there IS a body — Studio's
// DEFAULT_HEADERS are `{ Accept }` alone. Sending a content-type here instead
// would make Fastify reject the empty body before the handler ever runs, which
// tests the harness rather than the route.
const NO_BODY = { authorization: 'Bearer x' };

describe('POST /platform/auth/:ref/templates/:template/reset', () => {
  it('happy: kebab-cased template → /v1 receives the snake_cased mailer pair, both empty', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/auth/${REF}/templates/magic-link/reset`,
      headers: NO_BODY,
    });
    expect(res.statusCode).toBe(200);
    expect(patches[0]).toEqual({
      mailer_subjects_magic_link: '',
      mailer_templates_magic_link_content: '',
    });
    await app.close();
  });

  it('happy: a multi-word template kebab-cases correctly end to end', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/auth/${REF}/templates/mfa-factor-enrolled-notification/reset`,
      headers: NO_BODY,
    });
    expect(res.statusCode).toBe(200);
    expect(patches[0]).toEqual({
      mailer_subjects_mfa_factor_enrolled_notification: '',
      mailer_templates_mfa_factor_enrolled_notification_content: '',
    });
    await app.close();
  });

  it('happy: response is the FULL config in Studio casing, not just the reset fields', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/auth/${REF}/templates/recovery/reset`,
      headers: NO_BODY,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.SITE_URL).toBe('https://saved.test');
    expect(body.MAILER_SUBJECTS_RECOVERY).toBe('');
    expect(body.site_url).toBeUndefined(); // translated, not passed through
    await app.close();
  });

  it('sad: unknown template name → 400, and nothing is written', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/auth/${REF}/templates/not-a-template/reset`,
      headers: NO_BODY,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('unknown_template');
    expect(patches).toEqual([]);
    await app.close();
  });

  it('sad: a snake_cased name is rejected too — the contract is kebab only', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/auth/${REF}/templates/magic_link/reset`,
      headers: NO_BODY,
    });
    expect(res.statusCode).toBe(400);
    expect(patches).toEqual([]);
    await app.close();
  });

  it('sad: project not running → 409 surfaced from /v1, not a generic 500', async () => {
    const app = await buildApp({ notRunning: true });
    const res = await app.inject({
      method: 'POST',
      url: `/platform/auth/${REF}/templates/invite/reset`,
      headers: NO_BODY,
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});

describe('POST /platform/auth/:ref/validate/spam', () => {
  it('happy: valid body → 200 with an empty rule set (no fabricated score)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/auth/${REF}/validate/spam`,
      headers: AUTH,
      payload: { subject: 'Confirm your email', content: '<p>Hi</p>' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ rules: [] });
    await app.close();
  });

  it('sad: missing content → 400 rather than a silent empty pass', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/auth/${REF}/validate/spam`,
      headers: AUTH,
      payload: { subject: 'only a subject' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_body');
    await app.close();
  });

  it('sad: wrong types → 400', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/platform/auth/${REF}/validate/spam`,
      headers: AUTH,
      payload: { subject: 42, content: ['x'] },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
