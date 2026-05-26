/**
 * Redis-backed transient store for CLI device-code login sessions (feature 011).
 *
 * Shares the same Redis instance the dashboard sessions use; different key namespace.
 *
 *   Key:    selfbase:cli-login:<session_id>
 *   Value:  JSON payload (see SessionPayload type)
 *   TTL:    5 minutes (300s)
 *
 * Lifecycle: created on dashboard mint (`POST /api/v1/cli/login`); deleted
 * EITHER on first successful CLI poll (single-use) OR on TTL expiry.
 */

import { Redis } from 'ioredis';

export type SessionPayload = {
  device_code: string; // 8 lowercase hex
  access_token: string; // hex AES-GCM ciphertext || tag
  public_key: string; // hex uncompressed server P-256 pubkey
  nonce: string; // hex 12 bytes
  created_at: string; // ISO8601
  user_id: string; // operator who initiated the mint
};

const KEY_PREFIX = 'selfbase:cli-login:';
const TTL_SECONDS = 300;

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL not set');
    _redis = new Redis(url, { maxRetriesPerRequest: null });
  }
  return _redis;
}

/** Test-only: allow injecting a mock Redis instance. */
export function setRedisForTesting(client: Redis | null): void {
  _redis = client;
}

function key(sessionId: string): string {
  return `${KEY_PREFIX}${sessionId}`;
}

/** Write a fresh session bundle with TTL_SECONDS expiry. */
export async function putSession(sessionId: string, payload: SessionPayload): Promise<void> {
  await getRedis().set(key(sessionId), JSON.stringify(payload), 'EX', TTL_SECONDS);
}

/** Cheap existence check used by the mint route for replay rejection. */
export async function sessionExists(sessionId: string): Promise<boolean> {
  const n = await getRedis().exists(key(sessionId));
  return n > 0;
}

/**
 * Look up the session, verify device_code matches, and on success DELETE the
 * key (single-use semantics) before returning the payload. On any mismatch
 * — missing key OR wrong device_code — returns null WITHOUT deleting.
 */
export async function getAndConsume(
  sessionId: string,
  deviceCode: string,
): Promise<SessionPayload | null> {
  const raw = await getRedis().get(key(sessionId));
  if (!raw) return null;

  let parsed: SessionPayload;
  try {
    parsed = JSON.parse(raw) as SessionPayload;
  } catch {
    // Corrupt payload — treat as miss; let it TTL-expire.
    return null;
  }

  if (parsed.device_code !== deviceCode) return null;

  // Single-use: delete on match. Best-effort; if DEL fails (e.g., already
  // expired between GET and DEL), we still return the payload — the worst
  // case is a stale entry that auto-expires.
  await getRedis()
    .del(key(sessionId))
    .catch(() => {});

  return parsed;
}
