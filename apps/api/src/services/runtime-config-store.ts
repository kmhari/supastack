/**
 * Runtime config store — read/write project_config_snapshots for the
 * postgrest + auth surfaces. Source of truth for the GET response and
 * for the secret-sentinel round-trip merge on PATCH.
 *
 * Pipeline (PATCH):
 *   1. Acquire per-project Redis lock (R-004).
 *   2. Load current decrypted snapshot or defaults.
 *   3. Merge body over current; resolve "***" sentinels against current
 *      for every field in SECRET_FIELDS.
 *   4. Cross-field validate (OAuth enabled requires credentials).
 *   5. Read+backup current per-instance .env.
 *   6. For each honored field in the merged config: upsertEnvEntry.
 *      For fields whose transform returns '' (e.g. db_pool null), remove.
 *   7. Atomically write the new .env.
 *   8. UPSERT the snapshot row (encrypted) and bump version.
 *   9. restartOrRollback the surface's container (on failure: rollback
 *      .env + revert snapshot, throw 500 restart_failed).
 *  10. Emit one audit_log entry with the field-level diff (secrets redacted).
 *  11. Release lock.
 *
 * Pipeline (GET):
 *   1. SELECT the snapshot row (no lock needed).
 *   2. If row exists: decrypt → redact secrets → return.
 *   3. If row missing: return upstream-documented defaults.
 *
 * Spec: specs/009-runtime-config-tunables/spec.md FR-001..FR-011.
 * Research: R-001 (snapshot model), R-002 (encryption), R-003 (reload),
 *           R-004 (locking), R-007 (field mapping), R-008 (redaction sentinel).
 */
import { decryptJson, encryptJson, loadMasterKey } from '@supastack/crypto';
import { db, schema } from '@supastack/db';
import {
  POSTGREST_CONFIG_DEFAULTS,
  REDACTED_SECRET,
  SECRET_FIELDS,
  UpdateAuthConfigBodySchema,
  UpdatePostgrestConfigBodySchema,
} from '@supastack/shared';
import { and, eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ZodError } from 'zod';
import { ManagementApiError } from '../plugins/mgmt-api-errors.js';
import { recreateOrRollback, restartOrRollback } from './container-reload.js';
import {
  AUTH_CONFIG_FIELD_STATUS,
  AUTH_CONFIG_HONORED,
  POSTGREST_CONFIG_MAP,
  defaultEnvValueTransform,
  lookupAuthFieldMapping,
  lookupPostgrestFieldMapping,
} from './env-field-mapper.js';
import { removeEnvEntry, upsertEnvEntry } from './secret-store.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ConfigSurface = 'postgrest' | 'auth' | 'postgres' | 'storage' | 'realtime' | 'pgbouncer';

export type ConfigJson = Record<string, unknown>;

export type ConfigSource = { userId: string };

// ─── Constants ─────────────────────────────────────────────────────────────

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';

const LOCK_TTL_SECONDS = 60;

/** Auth-config defaults — minimal subset; remaining fields default to null. */
const AUTH_CONFIG_DEFAULTS: ConfigJson = {
  jwt_exp: 3600,
  disable_signup: false,
  external_email_enabled: true,
  external_phone_enabled: false,
  external_anonymous_users_enabled: false,
  mailer_autoconfirm: false,
  sms_autoconfirm: false,
};

// ─── Supastack extension (feature 020 US4) ──────────────────────────────────

/**
 * Per-field status indicator surfaced under `_supastack.fieldStatus` on the
 * auth-config GET response. Computed once at module init from
 * AUTH_CONFIG_FIELD_STATUS — per-request cost is zero.
 *
 * The key is namespaced (`_supastack`) so unmodified upstream `supabase` CLI
 * clients ignore it (FR-002, SC-005).
 *
 * Spec: specs/020-auth-providers-dashboard/spec.md FR-002, FR-003
 * Contract: specs/020-auth-providers-dashboard/contracts/auth-config-get-response.md
 */
export function buildAuthFieldStatusExtension(): {
  fieldStatus: Record<string, Record<string, unknown>>;
} {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [field, entry] of Object.entries(AUTH_CONFIG_FIELD_STATUS)) {
    if (entry.kind === 'honored') {
      const projection: Record<string, unknown> = {
        status: 'honored',
        envName: entry.envName,
      };
      if (entry.secret) projection.secret = true;
      out[field] = projection;
    } else if (entry.kind === 'stored_only') {
      out[field] = { status: 'stored_only', reason: entry.reason };
    } else {
      out[field] = { status: 'unsupported', reason: entry.reason };
    }
  }
  return { fieldStatus: out };
}

const AUTH_FIELD_STATUS_EXTENSION = Object.freeze(buildAuthFieldStatusExtension());

// ─── Public API ────────────────────────────────────────────────────────────

/** Reveal handler entry-point. Returns the plaintext config with secrets unredacted. */
export async function getPlaintextConfig(ref: string, surface: ConfigSurface): Promise<ConfigJson> {
  return loadCurrentPlaintext(ref, surface);
}

/** GET handler entry-point. Returns the redacted post-merge config. */
export async function getConfig(ref: string, surface: ConfigSurface): Promise<ConfigJson> {
  const plaintext = await loadCurrentPlaintext(ref, surface);
  const redacted = redactSecrets(plaintext);
  if (surface === 'auth') {
    // Inject the supastack extension. Postgrest surface is unchanged.
    return { ...redacted, _supastack: AUTH_FIELD_STATUS_EXTENSION };
  }
  return redacted;
}

/**
 * PATCH handler entry-point. Validates, merges, persists, reloads container,
 * audits. Returns the redacted post-merge config.
 *
 * Throws ManagementApiError on validation failure, lock contention, or
 * container restart failure.
 */
export async function patchConfig(
  ref: string,
  surface: ConfigSurface,
  body: unknown,
  source: ConfigSource,
): Promise<ConfigJson> {
  // 1. Schema validation. We map ZodError → ManagementApiError(400) to match
  //    upstream Supabase's convention (400 for validation, not 422). FR-005.
  let parsedBody: ConfigJson;
  try {
    parsedBody =
      surface === 'postgrest'
        ? (UpdatePostgrestConfigBodySchema.parse(body) as ConfigJson)
        : (UpdateAuthConfigBodySchema.parse(body) as ConfigJson);
  } catch (err) {
    if (err instanceof ZodError) {
      const details: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = issue.path.join('.') || '_root';
        details[key] = issue.code === 'unrecognized_keys' ? 'unknown_field' : issue.message;
      }
      // unrecognized_keys reports the keys in `issue.keys` rather than `path`.
      for (const issue of err.issues) {
        if (issue.code === 'unrecognized_keys') {
          for (const k of issue.keys) details[k] = 'unknown_field';
        }
      }
      throw new ManagementApiError(400, 'Validation failed', 'validation_failed', details);
    }
    throw err;
  }

  // 2. Acquire per-project lock (spans both surfaces — shared .env).
  return withProjectConfigLock(ref, async () => {
    // 3. Load current decrypted state.
    const current = await loadCurrentPlaintext(ref, surface);

    // 4. Merge body over current + resolve "***" sentinels.
    const merged = mergeWithSentinelResolution(current, parsedBody);

    // 5. Cross-field validation (OAuth missing credentials, etc.).
    crossFieldValidate(surface, merged);

    // 6. Diff for audit.
    const changedFields = computeChangedFields(current, merged);

    // No-op PATCH → skip restart + audit (FR-010 + spec edge case).
    if (changedFields.length === 0) {
      return redactSecrets(merged);
    }

    // 7. .env apply + container restart + snapshot upsert.
    await applyEnvAndRestart(ref, surface, merged);
    await persistSnapshot(ref, surface, merged, source.userId);

    // 8. Audit (with both old + new redacted for SECRET_FIELDS).
    await emitAudit(ref, surface, source.userId, current, merged, changedFields);

    return redactSecrets(merged);
  });
}

// ─── Internals ─────────────────────────────────────────────────────────────

export function containerNameFor(ref: string, surface: ConfigSurface): string {
  return surface === 'postgrest' ? `supastack-${ref}-rest-1` : `supastack-${ref}-auth-1`;
}

export function envPathFor(ref: string): string {
  return path.join(INSTANCES_DIR, ref, '.env');
}

const REALTIME_CONFIG_DEFAULTS: ConfigJson = {
  max_concurrent_users: 200,
};

const PGBOUNCER_CONFIG_DEFAULTS: ConfigJson = {
  pool_mode: 'transaction',
  default_pool_size: 15,
  ignore_startup_parameters: 'extra_float_digits',
  max_client_conn: 200,
  connection_string: '',
};

export function defaultsFor(surface: ConfigSurface): ConfigJson {
  switch (surface) {
    case 'postgrest':
      return { ...POSTGREST_CONFIG_DEFAULTS };
    case 'realtime':
      return { ...REALTIME_CONFIG_DEFAULTS };
    case 'pgbouncer':
      return { ...PGBOUNCER_CONFIG_DEFAULTS };
    default:
      return { ...AUTH_CONFIG_DEFAULTS };
  }
}

/**
 * Store-only config save — persists snapshot without writing .env or
 * restarting the container. Used for surfaces (realtime, pgbouncer) that
 * have no env-field mappings at this stage (deferred-apply posture).
 *
 * Does: load defaults → merge body → upsert snapshot → return merged.
 * No Redis lock, no env write, no container restart.
 */
export async function saveConfigOnly(
  ref: string,
  surface: ConfigSurface,
  data: ConfigJson,
  userId: string,
): Promise<ConfigJson> {
  const current = await loadCurrentPlaintext(ref, surface);
  const merged: ConfigJson = { ...current, ...data };
  await persistSnapshot(ref, surface, merged, userId);
  return merged;
}

async function loadCurrentPlaintext(ref: string, surface: ConfigSurface): Promise<ConfigJson> {
  const row = await db()
    .select({ payload: schema.projectConfigSnapshots.encryptedPayload })
    .from(schema.projectConfigSnapshots)
    .where(
      and(
        eq(schema.projectConfigSnapshots.instanceRef, ref),
        eq(schema.projectConfigSnapshots.surface, surface),
      ),
    )
    .limit(1);
  if (row[0]) {
    return decryptJson<ConfigJson>(row[0].payload, loadMasterKey());
  }
  return defaultsFor(surface);
}

function redactSecrets(plain: ConfigJson): ConfigJson {
  const out: ConfigJson = {};
  for (const [k, v] of Object.entries(plain)) {
    if (SECRET_FIELDS.has(k) && v !== null && v !== undefined && v !== '') {
      out[k] = REDACTED_SECRET;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Merge `body` over `current`. For every field in `body` whose value
 * equals REDACTED_SECRET and whose name is in SECRET_FIELDS, the merge
 * preserves `current`'s value (Q5 round-trip rule).
 */
function mergeWithSentinelResolution(current: ConfigJson, body: ConfigJson): ConfigJson {
  const out: ConfigJson = { ...current };
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (SECRET_FIELDS.has(k) && v === REDACTED_SECRET) {
      // Leave existing value unchanged.
      continue;
    }
    out[k] = v;
  }
  return out;
}

function crossFieldValidate(surface: ConfigSurface, merged: ConfigJson): void {
  if (surface !== 'auth') return;
  // OAuth providers ONLY — exclude built-in toggles like external_email_enabled
  // and external_phone_enabled which have no client_id/secret pair. Derive the
  // real provider list from SECRET_FIELDS (matches `external_<p>_secret`).
  const providers = Array.from(SECRET_FIELDS)
    .filter((f) => f.startsWith('external_') && f.endsWith('_secret'))
    .map((f) => f.slice('external_'.length, -'_secret'.length));
  const details: Record<string, string> = {};
  for (const p of providers) {
    if (merged[`external_${p}_enabled`] !== true) continue;
    const cid = merged[`external_${p}_client_id`];
    const sec = merged[`external_${p}_secret`];
    const cidEmpty = cid === null || cid === undefined || cid === '';
    const secEmpty = sec === null || sec === undefined || sec === '';
    if (cidEmpty || secEmpty) {
      details[`external_${p}`] = 'missing_credentials';
    }
  }
  if (Object.keys(details).length > 0) {
    throw new ManagementApiError(
      400,
      `Validation failed: one or more OAuth providers enabled without credentials.`,
      'validation_failed',
      details,
    );
  }

  validateHookConfig(merged);
}

// Exported for unit testing (feature 082).
export function validateHookConfig(merged: ConfigJson): void {
  const HOOK_TYPES = [
    'custom_access_token',
    'mfa_verification_attempt',
    'password_verification_attempt',
    'send_sms',
    'send_email',
    'before_user_created',
    'after_user_created',
  ] as const;

  for (const hookType of HOOK_TYPES) {
    const uriField = `hook_${hookType}_uri`;
    const enabledField = `hook_${hookType}_enabled`;
    const uri = merged[uriField];
    const enabled = merged[enabledField];

    if (uri !== null && uri !== undefined && uri !== '') {
      const uriStr = String(uri);
      if (!uriStr.startsWith('pg-functions://')) {
        const isHttp = uriStr.startsWith('https://') || uriStr.startsWith('http://');
        throw new ManagementApiError(
          400,
          isHttp
            ? 'HTTPS hook URIs are not yet supported. See issue #64 for progress.'
            : 'Hook URI scheme not supported. Only pg-functions:// is accepted (Phase 1). HTTPS support tracked in issue #64.',
          'hook_uri_scheme_unsupported',
          { field: uriField },
        );
      }
    }

    if (enabled === true && (uri === null || uri === undefined || uri === '')) {
      throw new ManagementApiError(
        400,
        'A URI is required when a hook is enabled.',
        'hook_uri_required',
        { field: uriField },
      );
    }
  }
}

function computeChangedFields(current: ConfigJson, merged: ConfigJson): string[] {
  const out: string[] = [];
  const keys = new Set([...Object.keys(current), ...Object.keys(merged)]);
  for (const k of keys) {
    if (current[k] !== merged[k]) {
      out.push(k);
    }
  }
  return out.sort();
}

async function applyEnvAndRestart(
  ref: string,
  surface: ConfigSurface,
  merged: ConfigJson,
): Promise<void> {
  const envPath = envPathFor(ref);
  const beforeEnv = await readFile(envPath, 'utf8').catch(() => '');
  let newEnv = beforeEnv;

  const lookup = surface === 'postgrest' ? lookupPostgrestFieldMapping : lookupAuthFieldMapping;
  const allKeys =
    surface === 'postgrest' ? Object.keys(POSTGREST_CONFIG_MAP) : Object.keys(AUTH_CONFIG_HONORED);

  for (const k of allKeys) {
    if (!(k in merged)) continue;
    const mapping = lookup(k);
    if (mapping.kind !== 'honored') continue;
    const transform = mapping.transform ?? defaultEnvValueTransform;
    const v = transform(merged[k]);
    if (v === '') {
      // Null / "auto-configured" → remove the env line entirely.
      newEnv = removeEnvEntry(newEnv, mapping.envName);
    } else {
      newEnv = upsertEnvEntry(newEnv, mapping.envName, v);
    }
  }

  if (newEnv === beforeEnv) {
    // Only stored-only fields changed; no container restart needed.
    return;
  }

  await atomicWrite(envPath, newEnv);
  // Use compose `up -d <service>` (recreate) so the new .env is re-substituted
  // into the container env. `docker restart` keeps the original env baked at
  // create-time, which silently breaks PATCH→container for any honored field.
  // The compose service names are `auth` and `rest` (per supabase-template's
  // service: lines); the container name is `supastack-<ref>-<service>-1`.
  const composeDir = path.join(INSTANCES_DIR, ref);
  const projectName = `supastack-${ref}`;
  const serviceName = surface === 'postgrest' ? 'rest' : 'auth';
  await recreateOrRollback(
    composeDir,
    projectName,
    serviceName,
    containerNameFor(ref, surface),
    envPath,
    beforeEnv,
  );
}
// keep restartOrRollback import used elsewhere (function-deploy hot path)
void restartOrRollback;

async function persistSnapshot(
  ref: string,
  surface: ConfigSurface,
  merged: ConfigJson,
  userId: string,
): Promise<void> {
  const encrypted = encryptJson(merged, loadMasterKey());
  const existing = await db()
    .select({ id: schema.projectConfigSnapshots.id })
    .from(schema.projectConfigSnapshots)
    .where(
      and(
        eq(schema.projectConfigSnapshots.instanceRef, ref),
        eq(schema.projectConfigSnapshots.surface, surface),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await db()
      .update(schema.projectConfigSnapshots)
      .set({
        encryptedPayload: encrypted,
        updatedAt: new Date(),
        updatedBy: userId,
      })
      .where(eq(schema.projectConfigSnapshots.id, existing[0].id));
  } else {
    await db().insert(schema.projectConfigSnapshots).values({
      instanceRef: ref,
      surface,
      encryptedPayload: encrypted,
      updatedBy: userId,
    });
  }
}

async function emitAudit(
  ref: string,
  surface: ConfigSurface,
  userId: string,
  before: ConfigJson,
  after: ConfigJson,
  changedFields: string[],
): Promise<void> {
  const diff: Record<string, { old: unknown; new: unknown }> = {};
  for (const k of changedFields) {
    if (SECRET_FIELDS.has(k)) {
      // Never leak secret plaintext into audit_log.
      diff[k] = { old: REDACTED_SECRET, new: REDACTED_SECRET };
    } else {
      diff[k] = { old: before[k] ?? null, new: after[k] ?? null };
    }
  }
  await db()
    .insert(schema.auditLog)
    .values({
      actorUserId: userId,
      action: surface === 'postgrest' ? 'mgmt_api.postgrest.update' : 'mgmt_api.auth_config.update',
      targetKind: 'instance',
      targetId: ref,
      payload: { ref, surface, changed_fields: changedFields, diff },
    });
}

// ─── Lock + file I/O helpers ────────────────────────────────────────────────

let _redis: Redis | null = null;
function getRedis(): Redis {
  if (_redis) return _redis;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not set — required for runtime-config-store');
  _redis = new Redis(url, { maxRetriesPerRequest: null });
  return _redis;
}

/**
 * Per-project Redis SETNX lock with `LOCK_TTL_SECONDS` TTL. Releases on
 * fn completion (success or throw). If another writer holds the lock,
 * throws 409 `config_write_in_progress` with the TTL in details.
 *
 * Exported for unit tests that inject a fake Redis client.
 */
export async function withProjectConfigLock<T>(
  ref: string,
  fn: () => Promise<T>,
  redisOverride?: Redis,
): Promise<T> {
  const redis = redisOverride ?? getRedis();
  const key = `supastack:config-write-lock:${ref}`;
  const token = `${process.pid}-${Date.now()}-${Math.random()}`;
  const acquired = await redis.set(key, token, 'EX', LOCK_TTL_SECONDS, 'NX');
  if (acquired !== 'OK') {
    throw new ManagementApiError(
      409,
      `Another config write is in progress for project ${ref}; retry after the lock expires.`,
      'config_write_in_progress',
      { ref, lock_ttl_seconds: LOCK_TTL_SECONDS },
    );
  }
  try {
    return await fn();
  } finally {
    // Only delete if we still own the token (avoid releasing someone else's
    // lock if our work overran the TTL).
    const current = await redis.get(key);
    if (current === token) {
      await redis.del(key).catch(() => {});
    }
  }
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, content, { mode: 0o600 });
  await rename(tmp, target);
}
