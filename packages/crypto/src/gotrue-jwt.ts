/**
 * Control-plane GoTrue JWT secret + verification (feature 084).
 *
 * GoTrue signs operator session JWTs with HS256 using `GOTRUE_JWT_SECRET` as the
 * HMAC key — and GoTrue treats that env value as a *string*, HMAC-ing with its
 * UTF-8 bytes. So the secret we hand GoTrue and the secret the api verifies with
 * must be the SAME string. We derive it from the master key via HKDF (Constitution
 * II — no new standalone secret; re-deriving from the master key reproduces it).
 *
 * Label `supastack-gotrue-jwt-v1` is domain-separated from the OAuth
 * (`selfbase-oauth-jwt-v1`) and the retired studio-shim labels.
 */
import { createHmac, hkdfSync } from 'node:crypto';

export const GOTRUE_JWT_HKDF_LABEL = 'supastack-gotrue-jwt-v1';

/**
 * The GoTrue HS256 secret as a 64-char hex string. This exact string is what
 * `GOTRUE_JWT_SECRET` is set to AND what the api verifies tokens against.
 */
export function deriveGotrueJwtSecret(masterKey: Buffer): string {
  const derived = hkdfSync('sha256', masterKey, Buffer.alloc(0), GOTRUE_JWT_HKDF_LABEL, 32);
  return Buffer.from(derived as ArrayBuffer).toString('hex');
}

export interface GotrueJwtClaims {
  sub: string;
  email?: string;
  role?: string;
  aud?: string | string[];
  exp: number;
  iat?: number;
  iss?: string;
  [k: string]: unknown;
}

export class GotrueJwtError extends Error {}

/**
 * Verify a GoTrue access JWT: HS256 signature against the derived secret string,
 * non-empty `sub`, and unexpired `exp`. Returns the decoded claims. supastack
 * org role is resolved separately from `organization_members` (NOT the JWT).
 */
export function verifyGotrueJwt(masterKey: Buffer, token: string, now?: number): GotrueJwtClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new GotrueJwtError('malformed JWT');
  const [h, p, sig] = parts as [string, string, string];
  const secret = deriveGotrueJwtSecret(masterKey);
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url');
  if (!timingSafeEqualStrings(sig, expected)) throw new GotrueJwtError('invalid signature');
  let claims: GotrueJwtClaims;
  try {
    claims = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
  } catch {
    throw new GotrueJwtError('payload not JSON');
  }
  if (!claims.sub) throw new GotrueJwtError('missing sub');
  const ts = now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp < ts) throw new GotrueJwtError('expired');
  return claims;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
