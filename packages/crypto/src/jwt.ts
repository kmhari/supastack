import jwt from 'jsonwebtoken';

const FIVE_YEARS_SEC = 5 * 365 * 24 * 60 * 60;

/**
 * Sign a Supabase-shaped JWT with HS256. Used to mint per-instance
 * `anon_key` and `service_role_key`. The signature MUST validate against
 * the same `jwtSecret` — verified by tests as the anti-SupaConsole
 * regression guard.
 */
export function signSupabaseJwt(
  jwtSecret: string,
  payload: { role: 'anon' | 'service_role'; iss?: string; expSec?: number },
): string {
  const iat = Math.floor(Date.now() / 1000);
  const body = {
    role: payload.role,
    iss: payload.iss ?? 'supabase',
    iat,
    exp: iat + (payload.expSec ?? FIVE_YEARS_SEC),
  };
  return jwt.sign(body, jwtSecret, { algorithm: 'HS256' });
}

/** Verify a signed JWT against the given secret. Returns the decoded payload or null. */
export function verifySupabaseJwt(token: string, jwtSecret: string): jwt.JwtPayload | null {
  try {
    const decoded = jwt.verify(token, jwtSecret, { algorithms: ['HS256'] });
    return typeof decoded === 'string' ? null : decoded;
  } catch {
    return null;
  }
}
