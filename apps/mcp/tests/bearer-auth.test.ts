import { describe, expect, it, beforeEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { signAccessToken } from '@selfbase/oauth';
import { AuthError, resolveBearer, wwwAuthenticateHeader } from '../src/bearer-auth.js';

/**
 * T036 — bearer-auth helper for the MCP HTTP transport.
 */

const APEX = 'test.example';
const ISSUER = `https://api.${APEX}`;
const AUDIENCE = `https://mcp.${APEX}/mcp`;
const masterKey = randomBytes(32);

class FakeRedis {
  store = new Set<string>();
  async set(): Promise<'OK'> {
    return 'OK';
  }
  async exists(k: string): Promise<number> {
    return this.store.has(k) ? 1 : 0;
  }
}

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
});

function mint(overrides: Partial<{ sub: string; ttlSec: number; iss: string; aud: string }> = {}) {
  return signAccessToken({
    masterKey,
    sub: overrides.sub ?? 'user-1',
    azp: '00000000-0000-0000-0000-000000000099',
    aud: overrides.aud ?? AUDIENCE,
    scope: 'platform',
    iss: overrides.iss ?? ISSUER,
    ttlSec: overrides.ttlSec ?? 3600,
  });
}

describe('resolveBearer', () => {
  it('valid JWT → returns claims', async () => {
    const { token, jti } = mint();
    const claims = await resolveBearer({
      authHeader: `Bearer ${token}`,
      masterKey,
      expectedIss: ISSUER,
      expectedAud: AUDIENCE,
      redis,
    });
    expect(claims.sub).toBe('user-1');
    expect(claims.jti).toBe(jti);
  });

  it('missing bearer → AuthError 401 unauthenticated', async () => {
    await expect(
      resolveBearer({
        authHeader: undefined,
        masterKey,
        expectedIss: ISSUER,
        expectedAud: AUDIENCE,
        redis,
      }),
    ).rejects.toMatchObject({ status: 401, errorCode: 'unauthenticated' });
  });

  it('non-Bearer scheme → AuthError 401 unauthenticated', async () => {
    await expect(
      resolveBearer({
        authHeader: 'Basic dXNlcjpwYXNz',
        masterKey,
        expectedIss: ISSUER,
        expectedAud: AUDIENCE,
        redis,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('expired JWT → AuthError 401 invalid_token', async () => {
    const { token } = mint({ ttlSec: -10 });
    await expect(
      resolveBearer({
        authHeader: `Bearer ${token}`,
        masterKey,
        expectedIss: ISSUER,
        expectedAud: AUDIENCE,
        redis,
      }),
    ).rejects.toMatchObject({ status: 401, errorCode: 'invalid_token' });
  });

  it('revoked JWT (jti in Redis) → AuthError 401 invalid_token', async () => {
    const { token, jti } = mint();
    redis.store.add(`selfbase:oauth:revoked:${jti}`);
    await expect(
      resolveBearer({
        authHeader: `Bearer ${token}`,
        masterKey,
        expectedIss: ISSUER,
        expectedAud: AUDIENCE,
        redis,
      }),
    ).rejects.toMatchObject({ status: 401, errorCode: 'invalid_token' });
  });

  it('wrong issuer → AuthError 401 invalid_token', async () => {
    const { token } = mint({ iss: 'https://other.example' });
    await expect(
      resolveBearer({
        authHeader: `Bearer ${token}`,
        masterKey,
        expectedIss: ISSUER,
        expectedAud: AUDIENCE,
        redis,
      }),
    ).rejects.toMatchObject({ status: 401, errorCode: 'invalid_token' });
  });

  it('AuthError is the only thrown type for verification failures', async () => {
    try {
      await resolveBearer({
        authHeader: 'Bearer not.a.jwt',
        masterKey,
        expectedIss: ISSUER,
        expectedAud: AUDIENCE,
        redis,
      });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
    }
  });
});

describe('wwwAuthenticateHeader', () => {
  it('includes resource + authorization_uri + error code per RFC 6750', () => {
    const h = wwwAuthenticateHeader(APEX, 'invalid_token');
    expect(h).toContain(`resource="https://mcp.${APEX}/mcp"`);
    expect(h).toContain(`authorization_uri="https://api.${APEX}/.well-known/oauth-authorization-server"`);
    expect(h).toContain('error="invalid_token"');
    expect(h).toContain('realm="selfbase"');
  });
});
