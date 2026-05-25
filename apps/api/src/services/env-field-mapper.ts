/**
 * Pure mapping table — upstream UpdateAuthConfigBody / UpdatePostgrestConfigBody
 * field name → corresponding env-var name in the per-instance .env, OR a marker
 * that the field is stored-only (persisted in project_config_snapshots but not
 * wired to a per-instance container env var).
 *
 * Source of env var names: infra/supabase-template/docker-compose.yml.
 *
 * KNOWN GAP (issue #21): the OAuth provider env-var lines in the per-instance
 * docker-compose.yml are COMMENTED OUT by default. They're listed here as
 * `honored` because the env-var name is the platform contract — when an
 * operator (or future provisioning code) uncomments them, the mapping just
 * works. Until then, setting `external_<provider>_enabled: true` via this API
 * writes the env line but the container has no template binding for it. The
 * audit log records the PATCH; the runtime behavior is a no-op. See issue #21
 * for the cleanup that flips all 22 providers to template-bound by default.
 *
 * Spec: specs/009-runtime-config-tunables/spec.md FR-003, FR-004; research.md R-007.
 */

export type FieldMapping =
  | { kind: 'honored'; envName: string; transform?: (v: unknown) => string }
  | { kind: 'stored_only' };

// ─── Postgrest config ──────────────────────────────────────────────────────
//
// All 4 fields are honored — they're wired in infra/supabase-template/docker-compose.yml
// today (search `PGRST_DB_` in that file).
//
// `db_pool` null means "auto-configured" — the env line MUST be omitted so the
// container's compiled default applies. Transform handles this signaling by
// returning the empty string, which the runtime-config-store interprets as
// "remove this env line."
export const POSTGREST_CONFIG_MAP: Record<string, FieldMapping> = {
  db_schema: { kind: 'honored', envName: 'PGRST_DB_SCHEMAS' },
  db_extra_search_path: { kind: 'honored', envName: 'PGRST_DB_EXTRA_SEARCH_PATH' },
  max_rows: { kind: 'honored', envName: 'PGRST_DB_MAX_ROWS' },
  // `db_pool` is accepted + persisted but stored-only today: the per-instance
  // docker-compose.yml does not reference $PGRST_DB_POOL, so writing it to
  // `.env` has no effect on the container. Treat as stored_only until the
  // template adds `PGRST_DB_POOL: ${PGRST_DB_POOL:-}` (tracked alongside #21).
  db_pool: { kind: 'stored_only' },
};

// ─── Auth config — honored entries ─────────────────────────────────────────
//
// Reality check (2026-05-25): the per-instance docker-compose.yml only wires
// THREE OAuth providers today — google, github, azure — and uses short .env
// var names (e.g. `GOOGLE_ENABLED`, not `GOTRUE_EXTERNAL_GOOGLE_ENABLED`).
// The GoTrue-prefixed env vars are populated via `${VAR}` substitution in
// the compose file.
//
// The other 19 providers in spec FR-003 (apple, bitbucket, discord, facebook,
// figma, fly, gitlab, kakao, keycloak, linkedin, notion, slack, snapchat,
// spotify, twitch, twitter, workos, x, zoom) are NOT in the template at all.
// They fall through to `stored_only` so PATCH succeeds (preserves CLI compat)
// but no env line is written. Issue #21 tracks adding the rest.
const TEMPLATE_BOUND_OAUTH_PROVIDERS: Record<
  string,
  { enabled: string; clientId: string; secret: string }
> = {
  google: { enabled: 'GOOGLE_ENABLED', clientId: 'GOOGLE_CLIENT_ID', secret: 'GOOGLE_SECRET' },
  github: { enabled: 'GITHUB_ENABLED', clientId: 'GITHUB_CLIENT_ID', secret: 'GITHUB_SECRET' },
  azure: { enabled: 'AZURE_ENABLED', clientId: 'AZURE_CLIENT_ID', secret: 'AZURE_SECRET' },
};

const CORE_AUTH_HONORED: Record<string, FieldMapping> = {
  jwt_exp: { kind: 'honored', envName: 'JWT_EXPIRY' },
  site_url: { kind: 'honored', envName: 'SITE_URL' },
  uri_allow_list: { kind: 'honored', envName: 'ADDITIONAL_REDIRECT_URLS' },
  disable_signup: { kind: 'honored', envName: 'DISABLE_SIGNUP' },

  external_email_enabled: { kind: 'honored', envName: 'ENABLE_EMAIL_SIGNUP' },
  external_phone_enabled: { kind: 'honored', envName: 'ENABLE_PHONE_SIGNUP' },
  external_anonymous_users_enabled: {
    kind: 'honored',
    envName: 'ENABLE_ANONYMOUS_USERS',
  },
  mailer_autoconfirm: { kind: 'honored', envName: 'ENABLE_EMAIL_AUTOCONFIRM' },
  sms_autoconfirm: { kind: 'honored', envName: 'ENABLE_PHONE_AUTOCONFIRM' },

  smtp_admin_email: { kind: 'honored', envName: 'SMTP_ADMIN_EMAIL' },
  smtp_host: { kind: 'honored', envName: 'SMTP_HOST' },
  smtp_port: { kind: 'honored', envName: 'SMTP_PORT' },
  smtp_user: { kind: 'honored', envName: 'SMTP_USER' },
  smtp_pass: { kind: 'honored', envName: 'SMTP_PASS' },
  smtp_sender_name: { kind: 'honored', envName: 'SMTP_SENDER_NAME' },
};

function oauthProviderEntries(): Record<string, FieldMapping> {
  const out: Record<string, FieldMapping> = {};
  for (const [p, envs] of Object.entries(TEMPLATE_BOUND_OAUTH_PROVIDERS)) {
    out[`external_${p}_enabled`] = { kind: 'honored', envName: envs.enabled };
    out[`external_${p}_client_id`] = { kind: 'honored', envName: envs.clientId };
    out[`external_${p}_secret`] = { kind: 'honored', envName: envs.secret };
  }
  return out;
}

/**
 * The honored subset of UpdateAuthConfigBody. Any field in
 * ALL_AUTH_CONFIG_FIELDS but NOT in this map is treated as
 * { kind: 'stored_only' }. We don't materialize a 234-entry map here —
 * `lookupAuthFieldMapping(name)` returns stored_only for any unknown key.
 */
export const AUTH_CONFIG_HONORED: Record<string, FieldMapping> = {
  ...CORE_AUTH_HONORED,
  ...oauthProviderEntries(),
};

/** Resolve a single auth-config field name to its mapping. */
export function lookupAuthFieldMapping(fieldName: string): FieldMapping {
  return AUTH_CONFIG_HONORED[fieldName] ?? { kind: 'stored_only' };
}

/** Resolve a single postgrest-config field name to its mapping. */
export function lookupPostgrestFieldMapping(fieldName: string): FieldMapping {
  return POSTGREST_CONFIG_MAP[fieldName] ?? { kind: 'stored_only' };
}

/**
 * Turn a single field value into its env-line representation.
 * Booleans render as 'true' / 'false'. Numbers stringify. null/undefined
 * yields '' which the caller treats as "remove the env line."
 */
export function defaultEnvValueTransform(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}
