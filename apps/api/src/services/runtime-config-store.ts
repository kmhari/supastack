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
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Redis } from 'ioredis';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { encryptJson, decryptJson, loadMasterKey } from '@selfbase/crypto';
import { ZodError } from 'zod';
import {
  REDACTED_SECRET,
  SECRET_FIELDS,
  UpdateAuthConfigBodySchema,
  UpdatePostgrestConfigBodySchema,
  POSTGREST_CONFIG_DEFAULTS,
} from '@selfbase/shared';
import { ManagementApiError } from '../plugins/mgmt-api-errors.js';
import { restartOrRollback } from './container-reload.js';
import {
  AUTH_CONFIG_HONORED,
  POSTGREST_CONFIG_MAP,
  defaultEnvValueTransform,
  lookupAuthFieldMapping,
  lookupPostgrestFieldMapping,
} from './env-field-mapper.js';
import { upsertEnvEntry, removeEnvEntry } from './secret-store.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ConfigSurface = 'postgrest' | 'auth';

type ConfigJson = Record<string, unknown>;

export type ConfigSource = { userId: string };

// ─── Constants ─────────────────────────────────────────────────────────────

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/selfbase/instances';

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

// ─── Public API ────────────────────────────────────────────────────────────

/** GET handler entry-point. Returns the redacted post-merge config. */
export async function getConfig(ref: string, surface: ConfigSurface): Promise<ConfigJson> {
  const plaintext = await loadCurrentPlaintext(ref, surface);
  return redactSecrets(plaintext);
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
  return surface === 'postgrest' ? `selfbase-${ref}-rest-1` : `selfbase-${ref}-auth-1`;
}

export function envPathFor(ref: string): string {
  return path.join(INSTANCES_DIR, ref, '.env');
}

export function defaultsFor(surface: ConfigSurface): ConfigJson {
  return surface === 'postgrest' ? { ...POSTGREST_CONFIG_DEFAULTS } : { ...AUTH_CONFIG_DEFAULTS };
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
  await restartOrRollback(containerNameFor(ref, surface), envPath, beforeEnv);
}

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
  const key = `selfbase:config-write-lock:${ref}`;
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
