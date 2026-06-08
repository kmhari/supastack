import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const auditCalls: Array<{ action: string; payload: unknown }> = [];

const mockClient = {
  id: '00000000-0000-0000-0000-000000000001',
  clientName: 'TestClient',
  redirectUris: ['http://localhost:9999/callback'],
};

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ email: 'operator@test.local' }],
        }),
      }),
    }),
    insert: () => ({
      values: async (vals: { action: string; payload: unknown }) => {
        auditCalls.push({ action: vals.action, payload: vals.payload });
      },
    }),
  }),
  schema: { users: { id: {}, email: {} }, auditLog: {} },
}));

vi.mock('@supastack/shared', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, logger: { warn: () => {}, info: () => {}, error: () => {} } };
});

vi.mock('../../src/services/oauth-clients-store.js', () => ({
  getClientById: async (id: string) => (id === mockClient.id ? mockClient : null),
  validateRedirectUri: (client: { redirectUris: string[] }, uri: string) =>
    client.redirectUris.includes(uri),
}));

vi.mock('../../src/services/oauth-codes-store.js', () => ({
  issueCode: async () => ({ code: 'test-code-abc123' }),
}));

const { oauthAuthorizeRoutes } = await import('../../src/routes/oauth/authorize.js');
const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');

const VALID_PARAMS = {
  response_type: 'code',
  client_id: mockClient.id,
  redirect_uri: 'http://localhost:9999/callback',
  state: 'state-xyz',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256',
  scope: 'platform',
};

async function buildApp(sessionUserId: string | null = null): Promise<FastifyInstance> {
  const app = Fastify();
  // Feature 084: authorize.ts resolves the operator from `req.user` (Bearer access
  // token, set by the auth preHandler) — not the legacy `sb_sid` session. Simulate
  // an authenticated operator by stamping req.user instead of req.session.
  app.decorateRequest('user', null);
  if (sessionUserId !== null) {
    app.addHook('preHandler', async (req) => {
      (req as any).user = { id: sessionUserId, email: `${sessionUserId}@x.dev`, role: 'developer' };
    });
  }
  await app.register(
    async (v1) => {
      await v1.register(mgmtApiErrorsPlugin);
      await v1.register(oauthAuthorizeRoutes);
    },
    { prefix: '/v1' },
  );
  return app;
}

beforeEach(() => {
  auditCalls.length = 0;
});

describe('GET /v1/oauth/authorize', () => {
  it('valid session + valid params → 200 HTML containing client_name', async () => {
    const app = await buildApp('u1');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize',
      query: VALID_PARAMS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('TestClient');
  });

  it('no session → 302 redirect to /dashboard/login?next=...', async () => {
    const app = await buildApp(null);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize',
      query: VALID_PARAMS,
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('/dashboard/login?next=');
  });

  it('unknown client_id → 400 invalid_client', async () => {
    const app = await buildApp('u1');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize',
      query: { ...VALID_PARAMS, client_id: '00000000-0000-0000-0000-999999999999' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_client');
  });

  it('redirect_uri not in allow-list → 400 invalid_request', async () => {
    const app = await buildApp('u1');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize',
      query: { ...VALID_PARAMS, redirect_uri: 'http://evil.example.com/callback' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_request');
  });

  it('code_challenge_method=plain → 400 invalid_request (OAuth 2.1 hardening)', async () => {
    const app = await buildApp('u1');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize',
      query: { ...VALID_PARAMS, code_challenge_method: 'plain' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_request');
  });
});

describe('POST /v1/oauth/authorize', () => {
  it('decision=authorize → 302 to redirect_uri?code=...&state=...; oauth.code.issued emitted', async () => {
    const app = await buildApp('u1');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/oauth/authorize',
      payload: { ...VALID_PARAMS, decision: 'authorize' },
    });
    expect(res.statusCode).toBe(302);
    const loc = res.headers['location'] as string;
    expect(loc).toContain('code=');
    expect(loc).toContain('state=');
    await new Promise((r) => setTimeout(r, 10));
    expect(auditCalls.some((c) => c.action === 'oauth.code.issued')).toBe(true);
  });

  it('decision=deny → 302 to redirect_uri?error=access_denied; oauth.consent.denied emitted', async () => {
    const app = await buildApp('u1');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/oauth/authorize',
      payload: { ...VALID_PARAMS, decision: 'deny' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toContain('error=access_denied');
    await new Promise((r) => setTimeout(r, 10));
    expect(auditCalls.some((c) => c.action === 'oauth.consent.denied')).toBe(true);
  });
});
