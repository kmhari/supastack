# Research: T078 — Master Key Rotation

## Encrypted tables inventory

All seven encrypted columns confirmed by source inspection:

| Table | Column | Nullable | Used by |
|-------|--------|----------|---------|
| `supabase_instances` | `encrypted_secrets` | No | Per-project secrets (JWT, PG password, API keys, etc.) |
| `project_config_snapshots` | `encrypted_payload` | No | Runtime config tunables (feature 009) |
| `project_secrets` | `encrypted_value` | No | Per-project vault secrets (feature 010) |
| `users` | `backup_store_config_encrypted` | Yes | S3 backup store credentials |
| `tls_accounts` | `account_key_pem` | No | ACME account private key (Let's Encrypt) |
| `tls_certs` | `key_pem` | Yes | Per-project TLS cert private key |
| `pg_edge_certs` | `key_pem` | Yes | PG-edge STARTTLS proxy cert private key |

## Re-key tool

- **Decision**: Standalone `scripts/rekey-master.mjs` (Node.js ESM, no build step) — already written on this branch.
- **Rationale**: Runs directly with `node` on the VM without needing a TypeScript compile step or pnpm install. The crypto primitives (`createCipheriv`, `createDecipheriv`, `randomBytes`) are Node stdlib — zero new dependencies. Uses `pg` directly (already installed as a transitive dep of the api container) to avoid Drizzle ORM overhead in a maintenance script.
- **Alternatives considered**: A Drizzle-based TS script — rejected: requires `tsx` or `tsc`, adds deployment complexity. A psql-based PL/pgSQL procedure — rejected: AES-256-GCM is not natively available in Postgres without pgcrypto extension, which is not enabled on the control-plane DB.

## Transaction strategy

- **Decision**: All seven tables re-keyed inside a single `BEGIN/COMMIT` block.
- **Rationale**: Atomic — either all blobs rotate or none do. The DB cannot enter a state where some blobs use the old key and some use the new key, which would make the api fail on some requests but not others.
- **Row count feasibility**: On the test VM, each table has O(10) rows. A single transaction across ~70 rows completes in milliseconds. The Postgres default `statement_timeout` on the control-plane DB is unset (no GUC override seen in schema), so no timeout risk.

## Verify-before-write pattern

- **Decision**: Each re-encrypted blob is decrypted with the new key before the UPDATE is issued. If verification fails, the transaction rolls back immediately.
- **Rationale**: Catches a bad `NEW_MASTER_KEY` (e.g., wrong length, typo) on the first row rather than committing garbled ciphertext.

## Pause/restore validation

- **Decision**: New E2E shell script `tests/cli-e2e/t078-key-rotation.sh` that orchestrates the full procedure: dry-run → live rekey → env swap via SSH → api restart → api-keys check → pause → restore → container health check.
- **Rationale**: Consistent with `t077-silent-refresh.sh` pattern. Shell + curl/ssh is sufficient; no new runtime deps needed. The script produces structured `[T078]` log lines suitable for pasting into the issue as evidence.
- **Alternatives considered**: Manual operator steps with no script — rejected: T078 acceptance requires "outcome documented" and the issue asks for a repeatable procedure, not a one-time manual checklist.

## Runbook

- **Decision**: `docs/changes/018-master-key-rotation.md` — same location as other feature change docs.
- **Content**: When to rotate, pre-rotation checklist, step-by-step procedure (script invocation + env update + restart + verify), rollback procedure (re-run script with keys swapped), post-rotation verification steps.
