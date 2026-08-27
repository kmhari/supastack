#!/usr/bin/env node
/**
 * Master-key rotation script.
 *
 * Re-encrypts every AES-256-GCM blob in the control-plane DB from OLD_MASTER_KEY
 * to NEW_MASTER_KEY, then verifies each row decrypts cleanly with the new key.
 * All updates run inside a single transaction — either everything rotates or
 * nothing does.
 *
 * Columns handled (every envelope-encrypted blob in the control-plane DB):
 *   supabase_instances        .encrypted_secrets
 *   supabase_instances        .create_smtp_pass_encrypted     (nullable)
 *   project_config_snapshots  .encrypted_payload
 *   project_secrets           .encrypted_value
 *   installation              .backup_store_config_encrypted  (nullable)
 *   installation              .smtp_config_encrypted          (nullable)
 *   wildcard_certs            .account_key_pem
 *   wildcard_certs            .key_pem                        (nullable)
 *   pg_edge_certs             .key_pem                        (nullable)
 *
 * A missing configured column ABORTS the run. It used to warn and continue,
 * which is how `tls_accounts`/`tls_certs` (names that never existed — the table
 * is `wildcard_certs`) and `users.backup_store_config_encrypted` (the column
 * lives on `installation`) silently skipped five columns through a real
 * rotation, orphaning them under a discarded key. An un-rotated blob is
 * unrecoverable, so this tool fails closed.
 *
 * A completeness sweep then checks every bytea column in the database against
 * COLUMNS + NOT_ENCRYPTED, so a newly added encrypted column aborts the run
 * instead of being quietly left behind.
 *
 * Usage (on the VM, inside the supastack repo):
 *   OLD_MASTER_KEY=<old 64-hex> \
 *   NEW_MASTER_KEY=<new 64-hex> \
 *   DATABASE_URL=postgres://... \
 *   node scripts/rekey-master.mjs
 *
 * Generate a new key: openssl rand -hex 32
 * Dry-run (no writes): DRY_RUN=1 node scripts/rekey-master.mjs
 *
 * After a successful run:
 *   1. Update MASTER_KEY in /opt/supastack/infra/.env to NEW_MASTER_KEY
 *   2. Restart api and worker: sudo docker compose restart api worker
 *   3. Verify a project pause+restore completes without errors
 */

import pg from 'pg';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function parseKey(raw, name) {
  if (!raw) throw new Error(`${name} env is missing`);
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;
  throw new Error(`${name} must be 64 hex chars or 32-byte base64`);
}

function decrypt(blob, key) {
  if (blob.length < IV_LEN + TAG_LEN) throw new Error('blob too short');
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(IV_LEN, blob.length - TAG_LEN);
  const d = createDecipheriv(ALG, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

function encrypt(plain, key) {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]);
}

function rekey(blob, oldKey, newKey) {
  return encrypt(decrypt(blob, oldKey), newKey);
}

const OLD_KEY = parseKey(process.env.OLD_MASTER_KEY, 'OLD_MASTER_KEY');
const NEW_KEY = parseKey(process.env.NEW_MASTER_KEY, 'NEW_MASTER_KEY');
const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error('DATABASE_URL env is missing');
const DRY_RUN = process.env.DRY_RUN === '1';

if (DRY_RUN) console.log('[rekey] DRY_RUN=1 — no writes will be made');

const client = new pg.Client({ connectionString: DB_URL });
await client.connect();

// `optional: true` means the column may legitimately be absent on an older
// deployment that has not run the migration adding it. Everything else must
// exist: a name that does not resolve is treated as a bug in this list, not as
// a deployment difference.
const COLUMNS = [
  { table: 'supabase_instances', id: 'ref', col: 'encrypted_secrets', nullable: false },
  { table: 'supabase_instances', id: 'ref', col: 'create_smtp_pass_encrypted', nullable: true },
  { table: 'project_config_snapshots', id: 'id', col: 'encrypted_payload', nullable: false },
  { table: 'project_secrets', id: 'id', col: 'encrypted_value', nullable: false },
  { table: 'installation', id: 'id', col: 'backup_store_config_encrypted', nullable: true },
  { table: 'installation', id: 'id', col: 'smtp_config_encrypted', nullable: true },
  { table: 'wildcard_certs', id: 'id', col: 'account_key_pem', nullable: false },
  { table: 'wildcard_certs', id: 'id', col: 'key_pem', nullable: true },
  { table: 'pg_edge_certs', id: 'id', col: 'key_pem', nullable: true },
];

// bytea columns that are NOT envelope-encrypted and must never be rekeyed.
// Both are SHA-256 digests: rekeying one would destroy the token it verifies.
const NOT_ENCRYPTED = new Set(['api_tokens.token_sha256', 'organization_invitations.token_sha256']);

/**
 * Every bytea column in the database must be accounted for — either rotated by
 * COLUMNS or explicitly declared non-encrypted. An unclassified one aborts:
 * silently leaving a blob under the old key is unrecoverable data loss, and
 * discovering that months later (as happened with wildcard_certs) is worse than
 * a failed rotation.
 */
async function assertNoUnclassifiedBlobColumns(client) {
  const { rows } = await client.query(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'bytea'
      ORDER BY table_name, column_name`,
  );
  const configured = new Set(COLUMNS.map((c) => `${c.table}.${c.col}`));
  const unclassified = rows
    .map((r) => `${r.table_name}.${r.column_name}`)
    .filter((k) => !configured.has(k) && !NOT_ENCRYPTED.has(k));
  if (unclassified.length) {
    throw new Error(
      `unclassified bytea column(s): ${unclassified.join(', ')}\n` +
        `  Add each to COLUMNS (if envelope-encrypted) or NOT_ENCRYPTED (if not).\n` +
        `  Refusing to rotate while a blob might be left under the old key.`,
    );
  }
  console.log(`[rekey] completeness: ${rows.length} bytea column(s), all classified`);
}

let totalRows = 0;

try {
  await client.query('BEGIN');

  await assertNoUnclassifiedBlobColumns(client);

  for (const { table, id, col, nullable, optional } of COLUMNS) {
    const { rows: colCheck } = await client.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
      [table, col],
    );
    if (colCheck.length === 0) {
      // Fail closed. A typo here used to read as "this deployment doesn't have
      // it" and skip, which is exactly how five columns missed a rotation.
      if (!optional) {
        throw new Error(
          `${table}.${col} does not exist. Either the name is wrong in COLUMNS, ` +
            `or this deployment predates it — in which case mark it optional: true.`,
        );
      }
      console.log(`[rekey] ${table}.${col}: absent, declared optional — skip`);
      continue;
    }

    const nullClause = nullable ? `AND ${col} IS NOT NULL` : '';
    const { rows } = await client.query(
      `SELECT ${id}, ${col} FROM ${table} WHERE ${col} IS NOT NULL ${nullClause}`,
    );

    if (rows.length === 0) {
      console.log(`[rekey] ${table}.${col}: 0 rows — skip`);
      continue;
    }

    let ok = 0;
    for (const row of rows) {
      const blob = row[col];
      let rekeyedBlob;
      try {
        rekeyedBlob = rekey(blob, OLD_KEY, NEW_KEY);
      } catch (err) {
        throw new Error(`[rekey] FAIL decrypt ${table}.${col} id=${row[id]}: ${err.message}`);
      }
      // Verify round-trip before writing
      try {
        decrypt(rekeyedBlob, NEW_KEY);
      } catch (err) {
        throw new Error(`[rekey] FAIL verify ${table}.${col} id=${row[id]}: ${err.message}`);
      }
      if (!DRY_RUN) {
        await client.query(`UPDATE ${table} SET ${col} = $1 WHERE ${id} = $2`, [
          rekeyedBlob,
          row[id],
        ]);
      }
      ok++;
    }

    console.log(`[rekey] ${table}.${col}: ${ok} row(s) re-encrypted${DRY_RUN ? ' (dry-run)' : ''}`);
    totalRows += ok;
  }

  if (!DRY_RUN) {
    await client.query('COMMIT');
    console.log(`\n[rekey] COMMITTED — ${totalRows} blob(s) rotated to new master key`);
    console.log('[rekey] Next steps:');
    console.log('  1. Update MASTER_KEY in /opt/supastack/infra/.env');
    console.log('  2. sudo docker compose restart api worker');
    console.log('  3. Pause and restore a project to verify decryption works');
  } else {
    await client.query('ROLLBACK');
    console.log(`\n[rekey] DRY-RUN complete — ${totalRows} blob(s) would be rotated`);
  }
} catch (err) {
  await client.query('ROLLBACK');
  console.error(`\n[rekey] ROLLED BACK: ${err.message}`);
  process.exit(1);
} finally {
  await client.end();
}
