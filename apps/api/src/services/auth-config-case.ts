import { ALL_AUTH_CONFIG_FIELDS } from '@supastack/shared';

/**
 * Bidirectional field-name case translation for the per-project auth config
 * (feature 085). Studio (IS_PLATFORM) speaks the GoTrue-config convention —
 * UPPERCASE field names (`EXTERNAL_GITHUB_ENABLED`) — while the Management API
 * `/v1/projects/:ref/config/auth` schema is `.strict()` lowercase snake_case
 * (`external_github_enabled`). For the auth surface these are the same tokens
 * modulo case, so the platform bridge translates here and leaves the `/v1`
 * contract untouched (Constitution IV).
 *
 * The `env-field-mapper` `envName` is NOT a usable bridge — it is inconsistent
 * (`jwt_exp`→`JWT_EXPIRY`, `uri_allow_list`→`ADDITIONAL_REDIRECT_URLS`). The
 * canonical token is the Management API field key (= `ALL_AUTH_CONFIG_FIELDS`,
 * derived from the strict schema), and Studio sends its UPPERCASE.
 */

/** Valid lowercase Management API field names (the schema's key set). */
const API_KEYS: ReadonlySet<string> = new Set(ALL_AUTH_CONFIG_FIELDS);

/**
 * Explicit exceptions where the Studio name diverges beyond a plain case-flip.
 * Empty today: every `ALL_AUTH_CONFIG_FIELDS` entry round-trips via toUpperCase
 * (verified exhaustively in auth-config-case.test.ts). Populate only if the live
 * Studio payload surfaces a field whose name is not `apiKey.toUpperCase()`.
 */
const STUDIO_TO_API: Readonly<Record<string, string>> = {};
const API_TO_STUDIO: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(STUDIO_TO_API).map(([studio, api]) => [api, studio]),
);

/** Meta keys that are NOT config fields and must never be case-translated. */
const META_KEYS: ReadonlySet<string> = new Set(['_supastack']);

/**
 * Studio (UPPERCASE) → Management API (lowercase). Unknown keys pass through
 * UNCHANGED so the strict `/v1` schema reports them as `unknown_field` rather
 * than the translation silently swallowing them. Partial payloads preserved.
 */
export function toApiKeys(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (META_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    const alias = STUDIO_TO_API[key];
    if (alias) {
      out[alias] = value;
      continue;
    }
    const lower = key.toLowerCase();
    out[API_KEYS.has(lower) ? lower : key] = value;
  }
  return out;
}

/**
 * Management API (lowercase) → Studio (UPPERCASE). The `_supastack` extension
 * object is passed through verbatim (NOT upper-cased — Studio ignores it, and
 * mangling it breaks feature 020's contract). Unknown keys pass through as-is.
 */
export function toStudioKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (META_KEYS.has(key)) {
      out[key] = value;
      continue;
    }
    const alias = API_TO_STUDIO[key];
    if (alias) {
      out[alias] = value;
      continue;
    }
    out[API_KEYS.has(key) ? key.toUpperCase() : key] = value;
  }
  return out;
}

/** Lowercase auth-config field names whose Studio shape this module governs. */
export const AUTH_CONFIG_API_KEYS = API_KEYS;
