/**
 * Writer for the three JWT-related assignments in a per-project `.env`.
 *
 * This lived on `POST /internal/instances/:ref/adopt-platform-jwt`, an
 * unauthenticated route whose whole purpose was to move a project ONTO the
 * shared platform JWT secret. Feature 123 (SEC-037) made every project's secret
 * per-project random, so that route became a way for anyone who could reach the
 * api to re-enrol a tenant into the shared blast radius — it was deleted. The
 * env transformation survives because re-keying a project needs exactly this.
 */
import { updateEnvFile } from '@supastack/docker-control';

export interface InstanceJwtTriple {
  jwtSecret: string;
  anonKey: string;
  serviceRoleKey: string;
}

/**
 * Rewrite `JWT_SECRET` / `ANON_KEY` / `SERVICE_ROLE_KEY`, leaving every other
 * line untouched.
 *
 * This used to be three anchored regex line replacements — a third independent
 * env writer with no guard at all. `updateEnvFile` holds the values to the
 * shared rule and parses the result back before returning it, so a multi-line
 * value can no longer split one assignment into two (feature 121, FR-013).
 */
/**
 * Every per-project service that receives JWT_SECRET, ANON_KEY, or
 * SERVICE_ROLE_KEY from the .env, and so must be RECREATED (not restarted) for
 * a key change to reach it. `infra/supabase-template/docker-compose.yml` is the
 * source of truth; a contract test holds this list to it.
 *
 * `db` is deliberately absent. JWT_SECRET reaches it only through
 * docker-entrypoint-initdb.d, which does not re-run on an existing data volume,
 * so its `app.settings.jwt_secret` GUC is re-issued with SQL instead.
 *
 * The pre-123 adopt-platform-jwt route recreated four of these and silently
 * left realtime, functions, and studio verifying against the previous secret.
 */
export const JWT_BEARING_SERVICES = [
  'kong',
  'auth',
  'rest',
  'realtime',
  'storage',
  'functions',
  'studio',
] as const;

/**
 * The `ref` claim of an issued anon/service_role key, or null for a pre-123 key
 * that names no project. Used to tell an already-re-keyed project from one
 * still on the shared secret without ever touching the shared secret itself.
 */
export function refClaimOf(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as {
      ref?: unknown;
    };
    return typeof claims.ref === 'string' ? claims.ref : null;
  } catch {
    return null;
  }
}

export function applyInstanceJwtToEnv(envContent: string, jwt: InstanceJwtTriple): string {
  return updateEnvFile(
    envContent,
    {
      JWT_SECRET: jwt.jwtSecret,
      ANON_KEY: jwt.anonKey,
      SERVICE_ROLE_KEY: jwt.serviceRoleKey,
    },
    'generated',
  );
}
