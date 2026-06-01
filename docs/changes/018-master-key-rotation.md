# Feature 018 — Master Key Rotation

## Overview

All sensitive per-project data in supastack is encrypted at rest using AES-256-GCM with a single operator-controlled master key (`MASTER_KEY` env var). This document describes when and how to rotate that key.

## When to rotate

- **Key compromise**: Any suspicion the current key has been exposed (leaked env file, shared credentials, insider threat)
- **Routine policy**: Some compliance frameworks require periodic key rotation (e.g., annually)
- **Staff departure**: Rotation after an operator with key access leaves the team

## Affected tables

| Table                      | Column                          | Purpose                                             |
| -------------------------- | ------------------------------- | --------------------------------------------------- |
| `supabase_instances`       | `encrypted_secrets`             | Per-project JWT secret, Postgres password, API keys |
| `project_config_snapshots` | `encrypted_payload`             | Runtime config tunables                             |
| `project_secrets`          | `encrypted_value`               | Per-project vault secrets                           |
| `users`                    | `backup_store_config_encrypted` | S3 backup store credentials                         |
| `tls_accounts`             | `account_key_pem`               | ACME account private key                            |
| `tls_certs`                | `key_pem`                       | Per-domain TLS cert private key                     |
| `pg_edge_certs`            | `key_pem`                       | PG edge proxy cert private key                      |

## Pre-rotation checklist

1. **Backup the database**: `pg_dump` the control-plane Postgres and store the backup off-VM before proceeding.
2. **Record the current key**: Note the current `MASTER_KEY` value from `/opt/supastack/infra/.env`. Keep it until rotation is fully confirmed — you'll need it as `OLD_MASTER_KEY` and as the rollback key.
3. **Choose a low-traffic window**: The re-key transaction is fast (< 1 second for typical row counts), but the api/worker restart causes ~10 seconds of downtime. Schedule accordingly.
4. **Ensure SSH access**: The re-key tool runs on the VM and requires direct `DATABASE_URL` access.

## Rotation procedure

### Step 1 — Generate a new key

```bash
openssl rand -hex 32
```

Save this value as `NEW_KEY`. Do not store it in shell history — set it in a variable only.

### Step 2 — Dry-run (no writes)

```bash
ssh ubuntu@<apex>
cd /opt/supastack
OLD=$(grep ^MASTER_KEY infra/.env | cut -d= -f2)
NEW=<paste your new key>

DRY_RUN=1 \
OLD_MASTER_KEY=$OLD \
NEW_MASTER_KEY=$NEW \
DATABASE_URL=$(grep ^DATABASE_URL infra/.env | cut -d= -f2) \
node scripts/rekey-master.mjs
```

Expected: one `[rekey] <table>: N row(s) would be rotated` line per populated table, then `DRY-RUN complete — N blob(s) would be rotated`. Verify the row counts match your expectations (cross-check with `SELECT COUNT(*) FROM supabase_instances`, etc.).

### Step 3 — Live re-key

```bash
OLD_MASTER_KEY=$OLD \
NEW_MASTER_KEY=$NEW \
DATABASE_URL=$(grep ^DATABASE_URL infra/.env | cut -d= -f2) \
node scripts/rekey-master.mjs
```

Expected final line: `[rekey] COMMITTED — N blob(s) rotated to new master key`. If the script exits non-zero, the transaction was rolled back — the database is unchanged. Investigate the error before retrying.

### Step 4 — Swap the key

```bash
sed -i "s/^MASTER_KEY=.*/MASTER_KEY=$NEW/" infra/.env
grep ^MASTER_KEY infra/.env   # verify
```

### Step 5 — Restart api + worker

```bash
sudo docker compose -f infra/docker-compose.yml restart api worker
```

Wait ~10 seconds, then confirm both are `Up`:

```bash
sudo docker compose -f infra/docker-compose.yml ps api worker
```

### Step 6 — Verify

```bash
# Confirm api decrypts secrets with new key
curl -s -H "Authorization: Bearer <PAT>" \
  https://api.<apex>/v1/projects/<ref>/api-keys | jq .

# Pause and restore a project to exercise the full lifecycle
curl -s -X POST -H "Authorization: Bearer <PAT>" \
  https://api.<apex>/v1/projects/<ref>/pause
# wait 30s
curl -s -X POST -H "Authorization: Bearer <PAT>" \
  https://api.<apex>/v1/projects/<ref>/restore
# wait for ACTIVE_HEALTHY (up to 5 min)
```

Or run the automated validation script (see `tests/cli-e2e/t078-key-rotation.sh`).

## Rollback procedure

If anything goes wrong after committing the re-key but before confirming the api works:

1. Re-run the re-key tool with keys **swapped** (new → old):
   ```bash
   OLD_MASTER_KEY=$NEW \
   NEW_MASTER_KEY=$OLD \
   DATABASE_URL=... \
   node scripts/rekey-master.mjs
   ```
2. Restore the old key in `.env`:
   ```bash
   sed -i "s/^MASTER_KEY=.*/MASTER_KEY=$OLD/" infra/.env
   ```
3. Restart api + worker.
4. Verify the api responds correctly.

If the re-key tool itself fails (exits non-zero), the transaction was rolled back and the database is unchanged — simply fix the issue and retry.

## Security notes

- **Never log key values**. The re-key tool does not log `OLD_MASTER_KEY` or `NEW_MASTER_KEY` values; neither should you in scripts, CI logs, or issue comments.
- **Dispose of the old key** after rotation is fully confirmed. Remove it from any notes, password managers, or shared docs.
- **The old key is now invalid** as soon as the re-key commits. Any api/worker process still running with the old key in memory will fail to decrypt on the next request. The restart in step 5 ensures no old-key processes remain.
- **Audit trail**: The re-key tool's stdout (with committed row counts) constitutes the audit record for the rotation. Retain it in a secure location.

## Post-rotation checklist

- [ ] `[rekey] COMMITTED` line recorded (with row count)
- [ ] `GET /v1/projects/:ref/api-keys` returns valid keys
- [ ] A project pause + restore completed successfully
- [ ] Old key removed from all storage locations
- [ ] Rotation event logged in operator runbook / incident record
