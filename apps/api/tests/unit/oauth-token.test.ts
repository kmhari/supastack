import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const auditCalls: Array<{ action: string }> = [];

type ConsumeResult =
  | { ok: true; userId: string; codeChallenge: string; scope: string; redirectUri: string; clientId: string }
  | { ok: false; error: string };

type RotateResult =
  | { ok: true; userId: string; scope: string; newToken: string }
  | { ok: false; error: string };

let consumeResult: ConsumeResult = {
  ok: true,
  userId: 'u1',
  codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  scope: 'platform',
  redirectUri: 'http://localhost:9999/callback',
  clientId: '00000000-0000-0000-0000-000000000001',
};

let rotateResult: RotateResult = {
  ok: true,
  userId: 'u1',
  scope: 'platform',
  newToken: 'new-refresh-token-xyz',
};

let verifyChallengeResult = true;

vi.mock('../../src/services/oauth-codes-store.js', () => ({
  consumeCode: async () => consumeResult,
}));

vi.mock('../../src/services/oauth-refresh-store.js', () => ({
  issueRefresh: async () => 'initial-refresh-token',
  rotateRefresh: async () => rotateResult,
}));

vi.mock('../../src/services/oauth-pkce.js', () => ({
  verifyChallenge: () => verifyChallengeResult,
}));

vi.mock('@selfbase/oauth', () => ({
  signAccessToken: () => ({ token: 'mock-access-token', jti: 'mock-jti' }),
}));

vi.mock('@selfbase/crypto', () => ({
  loadMasterKey: () => Buffer.alloc(32),
}));

vi.mock('@selfbase/shared', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, logger: { warn: () => {}, info: () => {}, error: () => {} } };
});

vi.mock('@selfbase/db', () => ({
  db: () => ({
    insert: () => ({
      values: async (vals: { action: string }) => {
        auditCalls.push({ action: vals.action });
      },
    }),
  }),
  schema: { auditLog: {} },
}));

const { oauthTokenRoutes } = await import('../../src/routes/oauth/token.js');
const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(
    async (v1) => {
      await v1.register(mgmtApiErrorsPlugin);
      await v1.register(oauthTokenRoutes);
    },
    { prefix: '/v1' },
  );
  return app;
}

const CLIENT_ID = '00000000-0000-0000-0000-000000000001';
const CODE_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const AUTH_CODE_BODY = {
  grant_type: 'authorization_code',
  code: 'test-code-123',
  redirect_uri: 'http://localhost:9999/callback',
  client_id: CLIENT_ID,
  code_verifier: CODE_VERIFIER,
};

beforeEach(() => {
  auditCalls.length = 0;
  consumeResult = {
    ok: true,
    userId: 'u1',
    codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    scope: 'platform',
    redirectUri: 'http://localhost:9999/callback',
    clientId: CLIENT_ID,
  };
  rotateResult = { ok: true, userId: 'u1', scope: 'platform', newToken: 'new-refresh-token-xyz' };
  verifyChallengeResult = true;
  process.env.SELFBASE_APEX = 'test.local';
});

describe('POST /v1/oauth/token — authorization_code', () => {
  it('happy path → 200 + access_token + refresh_token + expires_in:3600; oauth.token.issued emitted', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/oauth/token', payload: AUTH_CODE_BODY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.access_token).toBe('string');
    expect(typeof body.refresh_token).toBe('string');
    expect(body.expires_in).toBe(3600);
    await new Promise((r) => setTimeout(r, 10));
    expect(auditCalls.some((c) => c.action === 'oauth.token.issued')).toBe(true);
  });

  it('code reuse → 400 invalid_grant', async () => {
    consumeResult = { ok: false, error: 'already consumed' };
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/oauth/token', payload: AUTH_CODE_BODY });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_grant');
  });

  it('wrong code_verifier → 400 invalid_grant', async () => {
    verifyChallengeResult = false;
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/oauth/token', payload: AUTH_CODE_BODY });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_grant');
  });

  it('wrong redirect_uri at exchange → 400 invalid_grant', async () => {
    consumeResult = { ok: false, error: 'redirect_uri mismatch' };
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/oauth/token',
      payload: { ...AUTH_CODE_BODY, redirect_uri: 'http://wrong.example.com/cb' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_grant');
  });

  it('wrong client_id at exchange → 400 invalid_grant', async () => {
    consumeResult = { ok: false, error: 'client_id mismatch' };
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/oauth/token',
      payload: { ...AUTH_CODE_BODY, client_id: '00000000-0000-0000-0000-999999999999' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_grant');
  });
});

describe('POST /v1/oauth/token — refresh_token', () => {
  const REFRESH_BODY = {
    grant_type: 'refresh_token',
    refresh_token: 'existing-refresh-token',
    client_id: CLIENT_ID,
  };

  it('happy path → 200 + new access_token + new refresh_token; rotateRefresh called', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/oauth/token', payload: REFRESH_BODY });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.access_token).toBe('string');
    expect(body.refresh_token).toBe('new-refresh-token-xyz');
  });

  it('refresh token reuse → 400 invalid_grant', async () => {
    rotateResult = { ok: false, error: 'reuse-detected' };
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/oauth/token', payload: REFRESH_BODY });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_grant');
  });
});
