/**
 * Per-instance secret store — vault-backed (feature 010).
 *
 * Single source of truth is per-project Postgres `vault.secrets` (pgsodium
 * encrypted). This service is a thin facade: validate names against the
 * reserved list, then proxy reads/writes through `vault-client`.
 *
 * Wire contract preserved verbatim from feature 003 US4 (SC-008):
 *   - GET   → [{ name, value: sha256 }]                (bare array)
 *   - POST  ← [{ name, value }]                        (bare array)
 *   - DELETE ← [name, ...]                              (bare array of names)
 *
 * Error codes preserved: `reserved_name` (409), `validation` (422).
 *
 * Changes from previous implementation:
 *   - No `.env` writes
 *   - No functions-container restart on save
 *   - Saves propagate via the runtime's 5s TTL vault cache (≤10s, SC-002)
 *   - Existing `project_secrets` table is NOT read or written
 *     (deprecated; will be dropped in a follow-up migration per spec)
 *
 * Pure name-validation helpers (`validateSecretName`, `RESERVED_SECRET_NAMES`)
 * are preserved for backwards compatibility with existing unit tests in
 * `secret-store-name.test.ts`. The list now sources from `@supastack/shared`.
 */

import { createHash } from 'node:crypto';
import type { SecretListEntry } from '@supastack/shared';
import { RESERVED_SECRET_NAMES as SHARED_RESERVED } from '@supastack/shared';
import { ManagementApiError } from '../plugins/mgmt-api-errors.js';
import {
  withVaultClient,
  vaultListAll,
  vaultFindIdByName,
  vaultCreate,
  vaultUpdate,
  vaultDeleteByNames,
  InstanceNotFoundForVaultError,
  VaultUnreachableError,
} from './vault-client.js';

export type SecretWriteSource = { userId: string };

/**
 * Re-export the canonical reserved list so the existing
 * `secret-store-name.test.ts` keeps passing without churn (it imports from
 * this module). The TS const matches the JSON list materialized for the
 * runtime guard at injection time (FR-014 defense in depth).
 */
export const RESERVED_SECRET_NAMES: readonly string[] = Array.from(SHARED_RESERVED);

const SECRET_NAME_REGEX = /^[A-Z][A-Z0-9_]{0,63}$/;

export type ValidationResult =
  | { ok: true }
  | { ok: false; code: 'validation' | 'reserved_name'; message: string };

/**
 * Pure .env editor — DEPRECATED (no longer called by setSecrets/deleteSecrets
 * since feature 010 cut over to vault). Kept exported to preserve the unit
 * test suite at `tests/unit/env-editor.test.ts`; will be removed alongside
 * the `project_secrets` table drop in the follow-up migration.
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
    if (out.length > 0 && out[out.length - 1] === '') {
      out.splice(out.length - 1, 0, line);
    } else {
      out.push(line);
      out.push('');
    }
  }
  let result = out.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  return result;
}

/** Pure .env editor — DEPRECATED. See upsertEnvEntry. */
export function removeEnvEntry(existing: string, name: string): string {
  const keyMatcher = new RegExp(`^${escapeRegex(name)}=`);
  const lines = existing.split('\n');
  const out = lines.filter((l) => !keyMatcher.test(l));
  let result = out.join('\n');
  if (existing.endsWith('\n') && !result.endsWith('\n')) result += '\n';
  return result;
}

function formatEnvValue(value: string): string {
  const needsQuoting = /[\s#"']/.test(value) || value === '';
  if (!needsQuoting) return value;
  const escaped = value.replace(/"/g, '\\"');
  return `"${escaped}"`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Pure validator — regex + reserved-name check. No I/O. */
export function validateSecretName(name: string): ValidationResult {
  if (!SECRET_NAME_REGEX.test(name)) {
    return {
      ok: false,
      code: 'validation',
      message: `Secret name '${name}' is invalid. Must match ${SECRET_NAME_REGEX}.`,
    };
  }
  if (SHARED_RESERVED.has(name)) {
    return {
      ok: false,
      code: 'reserved_name',
      message: `Cannot set reserved secret: ${name}. This name is managed by the platform.`,
    };
  }
  return { ok: true };
}

// ─── Wire-facing operations (preserved contract, vault-backed body) ──────────

/**
 * List custom secrets for a project. Filters out reserved names defensively
 * (impossible by write-time guard, but cheap insurance against drift).
 * Returns `[{ name, value: sha256 }]` per the existing contract.
 */
export async function listSecrets(ref: string): Promise<SecretListEntry[]> {
  try {
    return await withVaultClient(ref, async (client) => {
      const rows = await vaultListAll(client);
      return rows
        .filter((r) => !SHARED_RESERVED.has(r.name))
        .map((r) => ({
          name: r.name,
          value: createHash('sha256').update(r.decryptedSecret, 'utf8').digest('hex'),
        }));
    });
  } catch (err) {
    throw translateVaultError(err, ref);
  }
}

/**
 * Atomic batch upsert. Validates every name up front (any failure rejects
 * the whole batch with the offending name in `details`). Persists in a
 * single Postgres transaction so partial-batch failures roll back cleanly.
 *
 * No container restart on success — propagation happens via the runtime's
 * 5s TTL vault cache (FR-014/015, SC-002).
 */
export async function setSecrets(
  ref: string,
  entries: Array<{ name: string; value: string }>,
  _source: SecretWriteSource,
): Promise<void> {
  // 1. Up-front validation: one bad name rejects the whole batch.
  for (const entry of entries) {
    const r = validateSecretName(entry.name);
    if (!r.ok) {
      throw new ManagementApiError(r.code === 'reserved_name' ? 409 : 422, r.message, r.code, {
        name: entry.name,
      });
    }
    if (entry.value === '') {
      throw new ManagementApiError(
        422,
        `Secret '${entry.name}' has empty value. Use DELETE to remove a secret.`,
        'validation',
        { name: entry.name },
      );
    }
  }

  if (entries.length === 0) return;

  try {
    await withVaultClient(ref, async (client) => {
      await client.query('BEGIN');
      try {
        for (const entry of entries) {
          const existingId = await vaultFindIdByName(client, entry.name);
          if (existingId) {
            await vaultUpdate(client, existingId, entry.value);
          } else {
            await vaultCreate(client, entry.name, entry.value);
          }
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    });
  } catch (err) {
    if (err instanceof ManagementApiError) throw err;
    throw translateVaultError(err, ref);
  }
}

/**
 * Batch delete. Names not present in vault are silently skipped (matches
 * prior behavior). Reserved names in the request → 409 (refuse the whole
 * batch for symmetry with POST), though by construction reserved names
 * shouldn't be in vault.
 */
export async function deleteSecrets(
  ref: string,
  names: string[],
  _source: SecretWriteSource,
): Promise<void> {
  if (names.length === 0) return;

  for (const name of names) {
    if (SHARED_RESERVED.has(name)) {
      throw new ManagementApiError(
        409,
        `Cannot delete reserved secret: ${name}. This name is managed by the platform.`,
        'reserved_name',
        { name },
      );
    }
  }

  try {
    await withVaultClient(ref, async (client) => {
      await vaultDeleteByNames(client, names);
    });
  } catch (err) {
    throw translateVaultError(err, ref);
  }
}

function translateVaultError(err: unknown, ref: string): ManagementApiError {
  if (err instanceof InstanceNotFoundForVaultError) {
    return new ManagementApiError(404, err.message, 'not_found', { ref });
  }
  if (err instanceof VaultUnreachableError) {
    return new ManagementApiError(
      503,
      `vault unreachable for ${ref}: ${err.message}`,
      'vault_unreachable',
      { ref },
    );
  }
  // Unexpected — propagate as 500. The Fastify error handler logs the stack.
  return new ManagementApiError(500, err instanceof Error ? err.message : String(err), 'internal', {
    ref,
  });
}
