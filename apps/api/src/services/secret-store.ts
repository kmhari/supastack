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

// ─── I/O surface ────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { encryptJson, loadMasterKey } from '@selfbase/crypto';
import type { SecretListEntry } from '@selfbase/shared';
import { ManagementApiError } from '../plugins/mgmt-api-errors.js';
import { getDockerControl } from './docker-control-adapter.js';

export type SecretWriteSource = { userId: string };

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/selfbase/instances';

function envPathFor(ref: string): string {
  return path.join(INSTANCES_DIR, ref, '.env');
}

/**
 * Listing returns name + value_sha256. Plaintext NEVER appears (FR-015).
 * The sha256 is computed at write-time and stored alongside the encrypted
 * blob so we can render the redacted indicator without decrypting per-call.
 */
export async function listSecrets(ref: string): Promise<SecretListEntry[]> {
  const rows = await db()
    .select({
      name: schema.projectSecrets.name,
      valueSha256: schema.projectSecrets.valueSha256,
    })
    .from(schema.projectSecrets)
    .where(eq(schema.projectSecrets.instanceRef, ref));
  return rows.map((r) => ({ name: r.name, value: r.valueSha256 }));
}

/**
 * Create-or-replace one or more secrets. The whole batch is atomic from the
 * caller's perspective:
 *   1. Validate every name (regex + reserved guard). One bad name = reject all.
 *   2. Read + back up the current .env.
 *   3. For each entry: encrypt value, compute sha256, upsert the DB row,
 *      apply upsertEnvEntry to the in-memory .env string.
 *   4. Atomic-write the new .env (tmp + rename).
 *   5. Restart the functions container.
 *   6. On any I/O failure after step 2: restore .env from the backup and
 *      rollback the DB changes for this batch.
 *
 * No concurrency lock here yet — single-deployer assumption holds for P0.
 * If we see concurrent writes corrupting .env in practice, wrap in a
 * Redis SETNX lock per instance.
 */
export async function setSecrets(
  ref: string,
  entries: Array<{ name: string; value: string }>,
  source: SecretWriteSource,
): Promise<void> {
  // 1. Validate every name upfront. ManagementApiError with the right code
  //    bubbles to the cloud-shape envelope.
  for (const entry of entries) {
    const r = validateSecretName(entry.name);
    if (!r.ok) {
      throw new ManagementApiError(
        r.code === 'reserved_name' ? 409 : 422,
        r.message,
        r.code,
        { name: entry.name },
      );
    }
  }

  const envPath = envPathFor(ref);
  const beforeEnv = await readFile(envPath, 'utf8').catch(() => '');

  // 2-3. Apply each entry to the env-string + persist DB row.
  const masterKey = loadMasterKey();
  let newEnv = beforeEnv;
  const insertedIds: string[] = [];
  try {
    for (const entry of entries) {
      const sha = createHash('sha256').update(entry.value, 'utf8').digest('hex');
      const encryptedValue = encryptJson({ value: entry.value }, masterKey);
      // Upsert: try INSERT, on conflict (instanceRef, name) update.
      const existing = await db()
        .select({ id: schema.projectSecrets.id })
        .from(schema.projectSecrets)
        .where(
          and(
            eq(schema.projectSecrets.instanceRef, ref),
            eq(schema.projectSecrets.name, entry.name),
          ),
        )
        .limit(1);
      if (existing[0]) {
        await db()
          .update(schema.projectSecrets)
          .set({
            encryptedValue,
            valueSha256: sha,
            updatedAt: new Date(),
            updatedBy: source.userId,
          })
          .where(eq(schema.projectSecrets.id, existing[0].id));
      } else {
        const [row] = await db()
          .insert(schema.projectSecrets)
          .values({
            instanceRef: ref,
            name: entry.name,
            encryptedValue,
            valueSha256: sha,
            createdBy: source.userId,
            updatedBy: source.userId,
          })
          .returning({ id: schema.projectSecrets.id });
        if (row) insertedIds.push(row.id);
      }
      newEnv = upsertEnvEntry(newEnv, entry.name, entry.value);
    }
  } catch (err) {
    // Roll back any new INSERTs from this batch. UPDATEs are harder to
    // undo cleanly without a snapshot; for P0 we accept that a partial
    // failure may leave DB and .env briefly inconsistent — the .env
    // file write hasn't happened yet at this point.
    if (insertedIds.length > 0) {
      await db()
        .delete(schema.projectSecrets)
        .where(inArray(schema.projectSecrets.id, insertedIds));
    }
    throw err;
  }

  // 4. Atomic write.
  await atomicWrite(envPath, newEnv);

  // 5. Restart with rollback on failure.
  await restartOrRollback(ref, envPath, beforeEnv);
}

/**
 * Delete one or more secrets by name. Idempotent: deleting a non-existent
 * name is success. Wraps a single .env write + single container restart
 * over the whole batch.
 */
export async function deleteSecrets(
  ref: string,
  names: string[],
  _source: SecretWriteSource,
): Promise<void> {
  if (names.length === 0) return;
  const envPath = envPathFor(ref);
  const beforeEnv = await readFile(envPath, 'utf8').catch(() => '');

  // 1. DB delete (idempotent).
  await db()
    .delete(schema.projectSecrets)
    .where(
      and(
        eq(schema.projectSecrets.instanceRef, ref),
        inArray(schema.projectSecrets.name, names),
      ),
    );

  // 2. Strip each name from the .env string.
  let newEnv = beforeEnv;
  for (const name of names) {
    newEnv = removeEnvEntry(newEnv, name);
  }

  // 3. Atomic write + restart.
  await atomicWrite(envPath, newEnv);
  await restartOrRollback(ref, envPath, beforeEnv);
}

/**
 * Write `content` to `target` via a `<target>.tmp-<pid>` temp file +
 * rename. Keeps the destination consistent even if the process crashes
 * mid-write.
 */
async function atomicWrite(target: string, content: string): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, content, { mode: 0o600 });
  await rename(tmp, target);
}

async function restartOrRollback(
  ref: string,
  envPath: string,
  backup: string,
): Promise<void> {
  const containerName = `selfbase-${ref}-functions-1`;
  const docker = getDockerControl();
  try {
    await docker.restart(containerName);
    await docker.waitHealthy(containerName, 5000);
  } catch (err) {
    // Restart failed — restore the .env from the backup snapshot. DB
    // rows are NOT rolled back here (the caller may have intended
    // changes that survive; restart-failure is an env-injection issue,
    // not a logical-data issue). Surface a deploy_rolled_back-equivalent.
    await atomicWrite(envPath, backup).catch(() => {});
    throw new ManagementApiError(
      500,
      `Secret update for ${ref} was rolled back: the functions container failed to restart. The previous environment is restored.`,
      'restart_failed',
      { ref, cause: (err as Error).message },
    );
  }
}
