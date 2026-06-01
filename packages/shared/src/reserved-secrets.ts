/**
 * Env vars supastack injects into the per-project **functions** container at
 * start time. These are the names visible to edge functions via
 * `Deno.env.get(...)` that are managed by the platform — operators cannot
 * set them via the secrets API/dashboard (api would 409, runtime would
 * filter them at injection time as defense in depth).
 *
 * Source of truth: the `functions` service env in
 * infra/supabase-template/docker-compose.yml. ANY env var defined there
 * is reserved. Env vars set by OTHER per-project containers (db, studio,
 * realtime, analytics, meta, etc.) are NOT visible to edge functions and
 * MUST NOT appear here — reserving them needlessly would block legitimate
 * user secret names like `POSTGRES_PASSWORD` (which an operator might want
 * to point at a different DB from an edge function).
 *
 * Materialized into infra/supabase-template/volumes/functions/main/
 * reserved-secrets.json at build time so the per-project runtime
 * (`main/index.ts`) can read it without crossing back to the api.
 *
 * Spec: 010-secrets-management — FR-026, research.md Decision 4.
 */

import data from './reserved-secrets.json' with { type: 'json' };

export type ReservedSecret = {
  name: string;
  description: string;
};

const DESCRIPTIONS: Record<string, string> = {
  JWT_SECRET: 'HS256 signing secret for legacy JWTs — managed by supastack',
  SUPABASE_URL: 'Project API base URL (Kong, internal) — managed by supastack',
  SUPABASE_PUBLIC_URL: 'Public-facing project URL — managed by supastack',
  SUPABASE_ANON_KEY: 'Anonymous API key — managed by supastack',
  SUPABASE_SERVICE_ROLE_KEY: 'Service-role API key — managed by supastack',
  SUPABASE_PUBLISHABLE_KEYS: 'Publishable API key set — managed by supastack',
  SUPABASE_SECRET_KEYS: 'Secret API key set — managed by supastack',
  SUPABASE_DB_URL: 'Per-project Postgres connection string — managed by supastack',
  VERIFY_JWT: 'Toggle for JWT verification at the functions edge — managed by supastack',
  SB_REF: 'Project ref (supastack metadata) — managed by supastack',
  SUPASTACK_VAULT_TTL_MS: 'Vault cache TTL in milliseconds — managed by supastack',
};

export const RESERVED_SECRETS: ReservedSecret[] = (data.reserved as string[]).map((name) => ({
  name,
  description: DESCRIPTIONS[name] ?? 'Managed by supastack',
}));

export const RESERVED_SECRET_NAMES: ReadonlySet<string> = new Set(
  RESERVED_SECRETS.map((s) => s.name),
);

export function isReservedSecretName(name: string): boolean {
  return RESERVED_SECRET_NAMES.has(name);
}
