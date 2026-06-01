#!/usr/bin/env node
/**
 * Master-key rotation script.
 *
 * Re-encrypts every AES-256-GCM blob in the control-plane DB from OLD_MASTER_KEY
 * to NEW_MASTER_KEY, then verifies each row decrypts cleanly with the new key.
 * All updates run inside a single transaction — either everything rotates or
 * nothing does.
 *
 * Tables handled:
 *   supabase_instances        .encrypted_secrets
 *   project_config_snapshots  .encrypted_payload
 *   project_secrets           .encrypted_value
 *   users                     .backup_store_config_encrypted  (nullable)
 *   tls_accounts              .account_key_pem
 *   tls_certs                 .key_pem                        (nullable)
 *   pg_edge_certs             .key_pem                        (nullable)
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

const TABLES = [
  { table: 'supabase_instances', id: 'ref', col: 'encrypted_secrets', nullable: false },
  { table: 'project_config_snapshots', id: 'id', col: 'encrypted_payload', nullable: false },
  { table: 'project_secrets', id: 'id', col: 'encrypted_value', nullable: false },
  { table: 'users', id: 'id', col: 'backup_store_config_encrypted', nullable: true },
  { table: 'tls_accounts', id: 'id', col: 'account_key_pem', nullable: false },
  { table: 'tls_certs', id: 'id', col: 'key_pem', nullable: true },
  { table: 'pg_edge_certs', id: 'id', col: 'key_pem', nullable: true },
];

let totalRows = 0;

try {
  await client.query('BEGIN');

  for (const { table, id, col, nullable } of TABLES) {
    // Skip if table or column doesn't exist on this deployment
    const { rows: colCheck } = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
      [table, col],
    );
    if (colCheck.length === 0) {
      console.log(`[rekey] ${table}.${col}: column not found — skip`);
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
