/**
 * Platform-managed env vars that selfbase injects into per-instance containers
 * at start time. Operators cannot set these via the secrets API/dashboard.
 *
 * Single source of truth for the *name list* is reserved-secrets.json (also
 * copied into the per-instance functions volume at build time so the Deno
 * runtime can read it without crossing back to the api).
 *
 * Descriptions are TS-only (presentation concern; the runtime doesn't need them).
 *
 * Spec: 010-secrets-management — FR-026, research.md Decision 4.
 */

import data from './reserved-secrets.json' with { type: 'json' };

export type ReservedSecret = {
  name: string;
  description: string;
};

const DESCRIPTIONS: Record<string, string> = {
  ANON_KEY: 'Anonymous API key (legacy alias) — managed by selfbase',
  SERVICE_ROLE_KEY: 'Service-role API key (legacy alias) — managed by selfbase',
  JWT_SECRET: 'HS256 signing secret for legacy JWTs — managed by selfbase',
  SUPABASE_URL: 'Project API base URL — injected by selfbase',
  SUPABASE_PUBLIC_URL: 'Public-facing project URL — injected by selfbase',
  SUPABASE_ANON_KEY: 'Anonymous API key — managed by selfbase',
  SUPABASE_SERVICE_ROLE_KEY: 'Service-role API key — managed by selfbase',
  SUPABASE_DB_URL: 'Per-project Postgres connection string — managed by selfbase',
  SUPABASE_PUBLISHABLE_KEY: 'Publishable API key — managed by selfbase',
  SUPABASE_SECRET_KEY: 'Secret API key — managed by selfbase',
  SUPABASE_PUBLISHABLE_KEYS: 'Publishable API key set — managed by selfbase',
  SUPABASE_SECRET_KEYS: 'Secret API key set — managed by selfbase',
  POSTGRES_PASSWORD: 'Per-project Postgres password — managed by selfbase',
  POSTGRES_HOST: 'Per-project Postgres host — managed by selfbase',
  POSTGRES_PORT: 'Per-project Postgres port — managed by selfbase',
  POSTGRES_DB: 'Per-project Postgres database name — managed by selfbase',
  VERIFY_JWT: 'Toggle for JWT verification at the functions edge — managed by selfbase',
  FUNCTIONS_VERIFY_JWT: 'Per-function JWT-verify toggle — managed by selfbase',
  DASHBOARD_USERNAME: 'Studio dashboard basic-auth username — managed by selfbase',
  DASHBOARD_PASSWORD: 'Studio dashboard basic-auth password — managed by selfbase',
  SECRET_KEY_BASE: 'Realtime/Analytics signing secret — managed by selfbase',
  VAULT_ENC_KEY: 'Per-project vault encryption key — managed by selfbase',
  LOGFLARE_PUBLIC_ACCESS_TOKEN: 'Analytics ingest token — managed by selfbase',
  LOGFLARE_PRIVATE_ACCESS_TOKEN: 'Analytics admin token — managed by selfbase',
  PG_META_CRYPTO_KEY: 'pg-meta encryption key — managed by selfbase',
};

export const RESERVED_SECRETS: ReservedSecret[] = (data.reserved as string[]).map((name) => ({
  name,
  description: DESCRIPTIONS[name] ?? 'Managed by selfbase',
}));

export const RESERVED_SECRET_NAMES: ReadonlySet<string> = new Set(
  RESERVED_SECRETS.map((s) => s.name),
);

export function isReservedSecretName(name: string): boolean {
  return RESERVED_SECRET_NAMES.has(name);
}
