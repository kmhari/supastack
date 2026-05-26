import { describe, expect, it } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import {
  deriveSigningKey,
  signAccessToken,
  verifyAccessToken,
  ExpiredTokenError,
  InvalidSignatureError,
  InvalidIssuerError,
  InvalidAudienceError,
  MalformedTokenError,
  JWT_HKDF_LABEL,
} from '../src/jwt.js';

/**
 * T008 — JWT sign/verify roundtrip + HKDF determinism + all error paths +
 * full claim set per FR-008.
 */

const masterKey = randomBytes(32);
const ISS = 'https://api.example.test';
const AUD = 'https://mcp.example.test/mcp';

function sign(overrides: Partial<{ ttlSec: number; iss: string; aud: string; sub: string }> = {}) {
  return signAccessToken({
    masterKey,
    sub: overrides.sub ?? 'user-1',
    azp: 'client-1',
    aud: overrides.aud ?? AUD,
    scope: 'platform',
    iss: overrides.iss ?? ISS,
    ttlSec: overrides.ttlSec ?? 3600,
  });
}

describe('deriveSigningKey', () => {
  it('is deterministic for the same master key', () => {
    const k1 = deriveSigningKey(masterKey);
    const k2 = deriveSigningKey(masterKey);
    expect(k1.equals(k2)).toBe(true);
    expect(k1.length).toBe(32);
  });

  it('differs for different master keys', () => {
    const otherMaster = randomBytes(32);
    expect(deriveSigningKey(masterKey).equals(deriveSigningKey(otherMaster))).toBe(false);
  });

  it('uses the documented HKDF label', () => {
    // Belt-and-braces: label change would invalidate every live token, so guard against rename
    expect(JWT_HKDF_LABEL).toBe('selfbase-oauth-jwt-v1');
  });
});

describe('signAccessToken + verifyAccessToken roundtrip', () => {
  it('verifies a freshly-signed token and returns all claims', () => {
    const { token, jti, exp } = sign();
    const claims = verifyAccessToken({ masterKey, token, expectedIss: ISS, expectedAud: AUD });
    expect(claims.sub).toBe('user-1');
    expect(claims.azp).toBe('client-1');
    expect(claims.aud).toBe(AUD);
    expect(claims.iss).toBe(ISS);
    expect(claims.scope).toBe('platform');
    expect(claims.jti).toBe(jti);
    expect(claims.exp).toBe(exp);
    expect(typeof claims.iat).toBe('number');
  });

  it('issues a fresh jti for every sign call', () => {
    const a = sign();
    const b = sign();
    expect(a.jti).not.toBe(b.jti);
  });

  it('token includes all 8 FR-008 required claims', () => {
    const { token } = sign();
    const claims = verifyAccessToken({ masterKey, token, expectedIss: ISS, expectedAud: AUD });
    for (const key of ['sub', 'azp', 'aud', 'scope', 'jti', 'iat', 'exp', 'iss'] as const) {
      expect(claims).toHaveProperty(key);
    }
  });
});

describe('verifyAccessToken — error paths', () => {
  it('throws ExpiredTokenError when exp is in the past', () => {
    // ttlSec=-10 → token is already expired
    const { token } = sign({ ttlSec: -10 });
    expect(() =>
      verifyAccessToken({ masterKey, token, expectedIss: ISS, expectedAud: AUD }),
    ).toThrow(ExpiredTokenError);
  });

  it('throws InvalidSignatureError when signature does not verify', () => {
    const { token } = sign();
    // Flip the last char to make signature invalid
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
    expect(() =>
      verifyAccessToken({ masterKey, token: tampered, expectedIss: ISS, expectedAud: AUD }),
    ).toThrow(InvalidSignatureError);
  });

  it('throws InvalidSignatureError when verified under a different master key', () => {
    const { token } = sign();
    const otherMaster = randomBytes(32);
    expect(() =>
      verifyAccessToken({
        masterKey: otherMaster,
        token,
        expectedIss: ISS,
        expectedAud: AUD,
      }),
    ).toThrow(InvalidSignatureError);
  });

  it('throws InvalidIssuerError when iss does not match', () => {
    const { token } = sign({ iss: 'https://other-iss.test' });
    expect(() =>
      verifyAccessToken({ masterKey, token, expectedIss: ISS, expectedAud: AUD }),
    ).toThrow(InvalidIssuerError);
  });

  it('throws InvalidAudienceError when aud does not match', () => {
    const { token } = sign({ aud: 'https://other-aud.test/mcp' });
    expect(() =>
      verifyAccessToken({ masterKey, token, expectedIss: ISS, expectedAud: AUD }),
    ).toThrow(InvalidAudienceError);
  });

  it('throws MalformedTokenError on segment count mismatch', () => {
    expect(() =>
      verifyAccessToken({
        masterKey,
        token: 'not.a.valid.jwt',
        expectedIss: ISS,
        expectedAud: AUD,
      }),
    ).toThrow(MalformedTokenError);
  });

  it('throws MalformedTokenError on non-JSON payload', () => {
    // Build a JWT with valid signature but garbage payload
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const garbage = Buffer.from('this-is-not-json').toString('base64url');
    const sig = createHmac('sha256', deriveSigningKey(masterKey))
      .update(`${header}.${garbage}`)
      .digest('base64url');
    const token = `${header}.${garbage}.${sig}`;
    expect(() =>
      verifyAccessToken({ masterKey, token, expectedIss: ISS, expectedAud: AUD }),
    ).toThrow(MalformedTokenError);
  });
});
