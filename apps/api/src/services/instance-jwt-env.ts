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
