/**
 * Redis-backed OAuth authorization sessions — feature 115.
 *
 * Short-lived (10-min TTL) server-side store for the OAuth 2.1 authorize flow.
 * `GET /v1/oauth/authorize` stashes the validated params here keyed by a UUID
 * `auth_id`, then redirects the browser to the Studio consent page
 * (`https://<apex>/dashboard/authorize?auth_id=...`). The consent page reads the
 * session via `GET /platform/oauth/authorizations/:id` and consumes it (atomic
 * GETDEL) on approve/deny — so a session is single-use and time-bounded.
 *
 * Spec: 115-oauth-authorize-flow — FR-001, FR-002, FR-007; data-model.md.
 */
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';

export interface OAuthAuthSession {
  auth_id: string;
  client_id: string;
  client_name: string;
  client_website: string;
  client_icon: string | null;
  client_domain: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  scopes: string[];
  created_at: string;
  expires_at: string;
}

export const AUTH_SESSION_TTL_SEC = 600;
const KEY_PREFIX = 'oauth:auth_session:';

// Per-process Redis client. Reuses the same REDIS_URL the auth plugin uses
// (mirrors apps/api/src/routes/oauth/clients-dashboard.ts).
let redisSingleton: Redis | null = null;
function getRedis(): Redis {
  if (!redisSingleton) {
    redisSingleton = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');
  }
  return redisSingleton;
}

export type CreateAuthSessionInput = Omit<
  OAuthAuthSession,
  'auth_id' | 'created_at' | 'expires_at'
>;

/**
 * Store a new authorization session and return its `auth_id`. `EX 600 NX` makes
 * creation atomic + idempotent (a fresh UUID never collides, so NX always wins).
 */
export async function createAuthSession(input: CreateAuthSessionInput): Promise<string> {
  const authId = randomUUID();
  const now = new Date();
  const session: OAuthAuthSession = {
    ...input,
    auth_id: authId,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + AUTH_SESSION_TTL_SEC * 1000).toISOString(),
  };
  await getRedis().set(
    KEY_PREFIX + authId,
    JSON.stringify(session),
    'EX',
    AUTH_SESSION_TTL_SEC,
    'NX',
  );
  return authId;
}

/** Read a session without consuming it. Returns null if missing/expired. */
export async function getAuthSession(authId: string): Promise<OAuthAuthSession | null> {
  return parse(await getRedis().get(KEY_PREFIX + authId));
}

/**
 * Atomically read + delete a session (single-use). Returns null if the session
 * was already consumed or expired — the caller maps that to 404. Atomicity
 * (`GETDEL`, Redis 6.2+) gives replay protection even under concurrent submits.
 */
export async function consumeAuthSession(authId: string): Promise<OAuthAuthSession | null> {
  return parse(await getRedis().getdel(KEY_PREFIX + authId));
}

function parse(raw: string | null): OAuthAuthSession | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthAuthSession;
  } catch {
    return null;
  }
}
