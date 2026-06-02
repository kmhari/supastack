#!/usr/bin/env node
// Derive the control-plane GoTrue JWT secret from MASTER_KEY (feature 084).
//
// GOTRUE_JWT_SECRET is NOT a new independent secret — it is deterministically
// derived from the master key, so re-running this reproduces the same value.
// The api verifies tokens by deriving the identical value at runtime
// (packages/crypto/src/gotrue-jwt.ts → deriveGotrueJwtSecret).
//
// Usage (at deploy, to populate infra/.env):
//   MASTER_KEY=<hex|base64> node scripts/derive-gotrue-secret.mjs >> infra/.env
// Prints:  GOTRUE_JWT_SECRET=<64 hex chars>
//
// MUST stay byte-for-byte in sync with:
//   - loadMasterKey()        (packages/crypto/src/aes-gcm.ts)
//   - deriveGotrueJwtSecret() (packages/crypto/src/gotrue-jwt.ts)
import { hkdfSync } from 'node:crypto';

const LABEL = 'supastack-gotrue-jwt-v1';

function loadMasterKey() {
  const raw = process.env.MASTER_KEY;
  if (!raw) {
    process.stderr.write('MASTER_KEY env is missing\n');
    process.exit(1);
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;
  process.stderr.write('MASTER_KEY must be 64 hex chars or 32 base64-decoded bytes\n');
  process.exit(1);
}

const derived = hkdfSync('sha256', loadMasterKey(), Buffer.alloc(0), LABEL, 32);
const secret = Buffer.from(derived).toString('hex');
process.stdout.write(`GOTRUE_JWT_SECRET=${secret}\n`);
