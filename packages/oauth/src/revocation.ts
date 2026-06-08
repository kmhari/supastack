/**
 * Redis-backed OAuth access-token revocation set.
 *
 * On revoke: set a key `supastack:oauth:revoked:<jti>` with TTL equal to the
 * token's remaining lifetime. On every auth-gated request: check the key.
 * Auto-expires; no manual GC.
 *
 * Caller-injected Redis client to keep this package driver-agnostic.
 *
 * Spec: 014-mcp-http-oauth — research.md Decision 4, FR-021a.
 */

export interface MinimalRedisClient {
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  exists(key: string): Promise<number>;
}

const KEY_PREFIX = 'supastack:oauth:revoked:';

export async function revoke(
  redis: MinimalRedisClient,
  jti: string,
  remainingSec: number,
): Promise<void> {
  // Guard: never set TTL <1s (Redis would reject or instant-expire)
  const ttl = Math.max(1, Math.floor(remainingSec));
  await redis.set(`${KEY_PREFIX}${jti}`, '1', 'EX', ttl);
}

export async function isRevoked(redis: MinimalRedisClient, jti: string): Promise<boolean> {
  const present = await redis.exists(`${KEY_PREFIX}${jti}`);
  return present === 1;
}
