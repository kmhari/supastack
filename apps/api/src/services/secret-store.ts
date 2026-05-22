/**
 * Per-instance secret store.
 *
 * Spec: specs/003-supabase-cli-compat-p0/research.md R-004, R-005
 *
 * Phase-2 stub. Pure helpers (RESERVED_SECRET_NAMES, validateSecretName,
 * upsertEnvEntry, removeEnvEntry) get their real implementations in T045 /
 * Phase 6. The signatures here are the contract the unit tests in T003a
 * exercise. Storage + I/O functions throw `not_implemented` until Phase 6.
 */

/**
 * Names selfbase already writes into the per-instance .env via its own
 * provisioning code. Setting any of these via the secrets API would
 * silently shadow a runtime-critical variable; we reject at API boundary
 * with `code: reserved_name`. Sourced from infra/supabase-template/
 * docker-compose.yml; see specs/.../research.md R-005.
 */
export const RESERVED_SECRET_NAMES = [
  'ANON_KEY',
  'SERVICE_ROLE_KEY',
  'JWT_SECRET',
  'SUPABASE_URL',
  'SUPABASE_PUBLIC_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SECRET_KEY',
  'SUPABASE_PUBLISHABLE_KEYS',
  'SUPABASE_SECRET_KEYS',
  'POSTGRES_PASSWORD',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'VERIFY_JWT',
  'FUNCTIONS_VERIFY_JWT',
  'DASHBOARD_USERNAME',
  'DASHBOARD_PASSWORD',
  'SECRET_KEY_BASE',
  'VAULT_ENC_KEY',
  'LOGFLARE_PUBLIC_ACCESS_TOKEN',
  'LOGFLARE_PRIVATE_ACCESS_TOKEN',
  'PG_META_CRYPTO_KEY',
] as const;

const SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]{0,63}$/;

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: 'validation' | 'reserved_name'; message: string };

/** Pure validator — regex + reserved-name check. No I/O. */
export function validateSecretName(name: string): ValidationResult {
  if (!SECRET_NAME_REGEX.test(name)) {
    return {
      ok: false,
      code: 'validation',
      message: `Secret name '${name}' is invalid. Must match ${SECRET_NAME_REGEX}.`,
    };
  }
  if ((RESERVED_SECRET_NAMES as readonly string[]).includes(name)) {
    return {
      ok: false,
      code: 'reserved_name',
      message: `Cannot set reserved secret: ${name}. This name is managed by the platform.`,
    };
  }
  return { ok: true };
}

/**
 * Pure .env editor — replaces or appends `name=value`, preserving
 * comments and unrelated lines. Quotes values that contain whitespace,
 * '#', or quotes so docker-compose env-file parsing doesn't truncate.
 */
export function upsertEnvEntry(existing: string, name: string, value: string): string {
  const formatted = formatEnvValue(value);
  const line = `${name}=${formatted}`;
  const lines = existing.split('\n');
  const keyMatcher = new RegExp(`^${escapeRegex(name)}=`);
  let replaced = false;
  const out: string[] = [];
  for (const l of lines) {
    if (!replaced && keyMatcher.test(l)) {
      out.push(line);
      replaced = true;
    } else {
      out.push(l);
    }
  }
  if (!replaced) {
    // Append before any trailing blank.
    if (out.length > 0 && out[out.length - 1] === '') {
      out.splice(out.length - 1, 0, line);
    } else {
      out.push(line);
      out.push('');
    }
  }
  // Ensure the file ends with exactly one newline.
  let result = out.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  return result;
}

/** Pure .env editor — deletes the line for `name`, no-op if absent. */
export function removeEnvEntry(existing: string, name: string): string {
  const keyMatcher = new RegExp(`^${escapeRegex(name)}=`);
  const lines = existing.split('\n');
  const out = lines.filter((l) => !keyMatcher.test(l));
  let result = out.join('\n');
  if (existing.endsWith('\n') && !result.endsWith('\n')) result += '\n';
  return result;
}

function formatEnvValue(value: string): string {
  // Quote if the value would otherwise be ambiguous to a shell-style parser.
  const needsQuoting = /[\s#"']/.test(value) || value === '';
  if (!needsQuoting) return value;
  // Escape only inner double-quotes — the wrapping pair is added below.
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── I/O surface (Phase 6 — currently stubs) ────────────────────────────────

export type SecretWriteSource = { userId: string };

export async function listSecrets(_ref: string): Promise<never> {
  throw new Error('not_implemented: listSecrets lands in T048');
}

export async function setSecrets(
  _ref: string,
  _entries: Array<{ name: string; value: string }>,
  _source: SecretWriteSource,
): Promise<never> {
  throw new Error('not_implemented: setSecrets lands in T048');
}

export async function deleteSecrets(
  _ref: string,
  _names: string[],
  _source: SecretWriteSource,
): Promise<never> {
  throw new Error('not_implemented: deleteSecrets lands in T048');
}
