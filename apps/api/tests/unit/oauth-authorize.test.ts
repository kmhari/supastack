/**
 * Unit tests for GET /v1/oauth/authorize (feature 115, T006).
 *
 * New behavior: validate params → store a server-side session → 303 redirect to
 * the Studio consent page. No inline HTML; no POST handler.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

process.env.SUPASTACK_APEX = 'example.test';

const mockClient = {
  id: '00000000-0000-0000-0000-000000000001',
  clientName: 'TestClient',
  redirectUris: ['http://localhost:9999/callback'],
  metadata: { website: 'https://claude.ai' },
};

const createCalls: unknown[] = [];

vi.mock('../../src/services/oauth-clients-store.js', () => ({
  getClientById: async (id: string) => (id === mockClient.id ? mockClient : null),
  validateRedirectUri: (client: { redirectUris: string[] }, uri: string) =>
    client.redirectUris.includes(uri),
}));

vi.mock('../../src/services/oauth-auth-sessions-store.js', () => ({
  createAuthSession: async (input: unknown) => {
    createCalls.push(input);
    return '11111111-2222-4333-8444-555555555555';
  },
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

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
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
  createCalls.length = 0;
});

describe('GET /v1/oauth/authorize', () => {
  it('valid params → 303 redirect to <apex>/dashboard/authorize?auth_id=...; session created (happy)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/oauth/authorize', query: VALID_PARAMS });
    expect(res.statusCode).toBe(303);
    expect(res.headers['location']).toBe(
      'https://example.test/dashboard/authorize?auth_id=11111111-2222-4333-8444-555555555555',
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({
      client_id: mockClient.id,
      client_name: 'TestClient',
      client_website: 'https://claude.ai',
      client_icon: null,
      client_domain: 'localhost',
      redirect_uri: 'http://localhost:9999/callback',
      state: 'state-xyz',
      code_challenge: VALID_PARAMS.code_challenge,
      code_challenge_method: 'S256',
      scopes: ['platform'],
    });
  });

  it('clean URL — Location carries only auth_id, no raw OAuth params (US2 / SC-002)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/oauth/authorize', query: VALID_PARAMS });
    const loc = res.headers['location'] as string;
    expect(loc).toContain('auth_id=');
    expect(loc).not.toContain('code_challenge');
    expect(loc).not.toContain('redirect_uri');
    expect(loc).not.toContain('state=');
  });

  it('unknown client_id → 400 invalid_client (sad)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize',
      query: { ...VALID_PARAMS, client_id: '00000000-0000-0000-0000-999999999999' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_client');
    expect(createCalls).toHaveLength(0);
  });

  it('redirect_uri not in allow-list → 400 invalid_request (sad)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize',
      query: { ...VALID_PARAMS, redirect_uri: 'http://evil.example.com/callback' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_request');
    expect(createCalls).toHaveLength(0);
  });

  it('code_challenge_method=plain → 400 invalid_request (OAuth 2.1 hardening — sad)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/oauth/authorize',
      query: { ...VALID_PARAMS, code_challenge_method: 'plain' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_request');
  });
});
