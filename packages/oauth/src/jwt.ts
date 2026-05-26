/**
 * OAuth 2.1 access-token JWT signing + verification.
 *
 * HS256 with an HKDF-SHA256-derived key from the existing selfbase master key.
 * Label: `selfbase-oauth-jwt-v1` — domain-separated so a future re-key with a
 * different label can't mint tokens that verify against the v1 key.
 *
 * Shared between `apps/api` (auth plugin) and `apps/mcp` (bearer-auth) so
 * both processes verify identically.
 *
 * Spec: 014-mcp-http-oauth — research.md Decision 3, FR-008, FR-024.
 */
import { createHmac, hkdfSync, randomUUID } from 'node:crypto';

export const JWT_HKDF_LABEL = 'selfbase-oauth-jwt-v1';
export const JWT_ALG = 'HS256';
export const JWT_TYP = 'JWT';

export class InvalidSignatureError extends Error {
  code = 'invalid_signature' as const;
}
export class ExpiredTokenError extends Error {
  code = 'expired' as const;
}
export class InvalidIssuerError extends Error {
  code = 'invalid_issuer' as const;
}
export class InvalidAudienceError extends Error {
  code = 'invalid_audience' as const;
}
export class MalformedTokenError extends Error {
  code = 'malformed' as const;
}

export interface OAuthAccessTokenClaims {
  sub: string;
  azp: string;
  aud: string;
  scope: string;
  jti: string;
  iat: number;
  exp: number;
  iss: string;
}

export interface SignArgs {
  masterKey: Buffer;
  sub: string;
  azp: string;
  aud: string;
  scope: string;
  iss: string;
  ttlSec: number;
  now?: number;
}

export interface SignResult {
  token: string;
  jti: string;
  exp: number;
}

export function deriveSigningKey(masterKey: Buffer): Buffer {
  const derived = hkdfSync('sha256', masterKey, Buffer.alloc(0), JWT_HKDF_LABEL, 32);
  return Buffer.from(derived as ArrayBuffer);
}

export function signAccessToken(args: SignArgs): SignResult {
  const now = args.now ?? Math.floor(Date.now() / 1000);
  const exp = now + args.ttlSec;
  const jti = randomUUID();
  const claims: OAuthAccessTokenClaims = {
    sub: args.sub,
    azp: args.azp,
    aud: args.aud,
    scope: args.scope,
    jti,
    iat: now,
    exp,
    iss: args.iss,
  };
  const header = base64url(Buffer.from(JSON.stringify({ alg: JWT_ALG, typ: JWT_TYP })));
  const payload = base64url(Buffer.from(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const signature = base64url(
    createHmac('sha256', deriveSigningKey(args.masterKey)).update(signingInput).digest(),
  );
  return { token: `${signingInput}.${signature}`, jti, exp };
}

export interface VerifyArgs {
  masterKey: Buffer;
  token: string;
  expectedIss: string;
  expectedAud: string;
  now?: number;
}

export function verifyAccessToken(args: VerifyArgs): OAuthAccessTokenClaims {
  const parts = args.token.split('.');
  if (parts.length !== 3) throw new MalformedTokenError('JWT must have 3 segments');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  // Constant-time signature check
  const expected = base64url(
    createHmac('sha256', deriveSigningKey(args.masterKey))
      .update(`${headerB64}.${payloadB64}`)
      .digest(),
  );
  if (!timingSafeEqualStrings(sigB64, expected)) {
    throw new InvalidSignatureError('JWT signature does not verify');
  }

  let claims: OAuthAccessTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new MalformedTokenError('JWT payload is not valid JSON');
  }

  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < now) {
    throw new ExpiredTokenError(`token expired at ${claims.exp}`);
  }
  if (claims.iss !== args.expectedIss) {
    throw new InvalidIssuerError(`expected iss=${args.expectedIss}, got ${claims.iss}`);
  }
  if (claims.aud !== args.expectedAud) {
    throw new InvalidAudienceError(`expected aud=${args.expectedAud}, got ${claims.aud}`);
  }
  return claims;
}

function base64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
