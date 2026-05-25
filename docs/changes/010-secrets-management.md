# Feature 010 — Secrets management (single-track via supabase_vault)

**Spec**: [specs/010-secrets-management/spec.md](../../specs/010-secrets-management/spec.md)
**Issues closed**: #5 (vault enablement) + dashboard secrets UI gap

## What changed

User-managed edge-function secrets now live in per-project `vault.secrets` (pgsodium-encrypted) as the single source of truth. Saves propagate to the Deno runtime via a 5-second in-process TTL cache — **no more functions-container restart on save**.

| Surface                                       | Before                                                              | After                                            |
| --------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| Storage                                       | `project_secrets` table (control plane) + per-instance `.env` file  | `vault.secrets` (per-project Postgres)           |
| Save → `Deno.env.get(...)`                    | ~15s container restart                                              | ≤5s (TTL cache refresh)                          |
| Dashboard UI                                  | none (curl / supabase CLI only)                                     | `/dashboard/project/<ref>/secrets`               |
| SQL callers (`pg_cron`, triggers, `pg_net`)   | extensions not installed → `vault.decrypted_secrets` does not exist | enabled at provision time + via dashboard button |
| Studio's `/project/default/functions/secrets` | docs-only stub (dead UX)                                            | 302 → selfbase secrets page                      |

## Architecture

```
operator                                                        edge function
   │                                                                   ▲
   │ POST /api/v1/projects/<ref>/secrets                              │ Deno.env.get('OPENAI_KEY')
   │   (dashboard or supabase CLI)                                     │
   ▼                                                                   │
selfbase api                                                  selfbase functions/main/index.ts
   │                                                                   │
   │ secretStore.setSecrets() → vault-client                           │ getEnvVars()   ┌─ in-process TTL cache (5s)
   │   BEGIN; vault.create_secret/.update_secret; COMMIT;              │   ├─ hit ──────┤
   │                                                                   │   └─ miss ─►   refreshVault()
   ▼                                                                                       │
per-project Postgres                                                                       │ SELECT name, decrypted_secret
   vault.secrets (pgsodium-encrypted)            ◄──────────────────────────────────────────┘  FROM vault.decrypted_secrets
   vault.decrypted_secrets (view)                                                              WHERE key_id IS NOT NULL
```

## Breaking change at cutover

**Pre-existing secrets stored in `project_secrets` are NOT migrated to vault.** Operators must re-enter every secret via the dashboard (or `supabase secrets set` CLI) after deploying this feature.

Why: the only deployment had zero non-test workloads — the cleanest cutover beats a one-shot migrate-and-pray script. The deprecated `project_secrets` table is left in place; a follow-up migration (`0011_drop_project_secrets.sql` draft below) drops it after a deprecation window.

## Operator runbook

### Configuration knobs

| Env var                 | Container               | Default                      | Purpose                                                                                                                                                                           |
| ----------------------- | ----------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SELFBASE_VAULT_TTL_MS` | per-project `functions` | `5000`                       | In-process cache TTL for vault reads. Shorten for diagnosis (cost: more DB queries). Longer values widen the save → propagation budget.                                           |
| `SB_REF`                | per-project `functions` | (from compose `PROJECT_REF`) | Identifies the project in `[selfbase-vault] ...` log lines.                                                                                                                       |
| `SUPABASE_DB_URL`       | per-project `functions` | (set by template)            | Reused for vault reads — the `postgres` role is SUPERUSER in `supabase/postgres` and can `SELECT vault.decrypted_secrets`. No separate `SELFBASE_VAULT_DB_URL` needed by default. |

### Per-project commands

```bash
# Verify vault extensions installed on an instance
sudo docker exec selfbase-<ref>-db-1 psql -U supabase_admin -d postgres -c \
  "SELECT extname FROM pg_extension WHERE extname IN ('pgsodium','supabase_vault')"

# Manual re-enable (dashboard button equivalent — calls vault-enable BullMQ job)
curl -X POST https://<apex>/api/v1/projects/<ref>/vault/enable \
  -H "Cookie: <session-cookie>"

# Read a secret via SQL (for confirming a vault-backed config)
sudo docker exec selfbase-<ref>-db-1 psql -U postgres -d postgres -c \
  "SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name = 'MY_KEY'"
```

### Failure modes & recovery

| Symptom                                                             | Diagnosis                                                                                     | Recovery                                                                                                                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard shows "vault unreachable for <ref>" (503)                 | Per-instance Postgres down/paused, or vault extensions never installed                        | Resume project; if still failing, click "Enable vault" in dashboard (re-runs the worker job)                                                                         |
| Edge function gets `undefined` for a secret that's set in dashboard | Cache miss + DB unreachable during refresh → fell back to no-secrets spawn                    | Check `docker logs selfbase-<ref>-functions-1 \| grep selfbase-vault`. Look for `refresh failed; no cache`. Usually transient (DB blip); retries on next invocation. |
| `vault-enable` worker job stuck in `failed` state                   | `VaultBootstrapError` payload names the failing stage (`create-pgsodium`, `smoke-test`, etc.) | Inspect job in BullMQ. If `smoke-test` fails → check the per-project Postgres has libsodium (rare; bundled in `supabase/postgres:15.8.1.085`).                       |
| Save in dashboard but propagation >10s                              | TTL window expired but DB query slow                                                          | Check `[selfbase-vault] refreshed N secrets in Xms` log lines; if X > 500ms consistently, investigate per-project Postgres health                                    |

### Caveats

- **TTL cache is per functions-container**: a project with replicas would see independent caches refreshing on their own schedules. Selfbase has one functions container per project today, so this is a non-issue.
- **Reserved-name guard is two-layer**: api rejects writes at `instance.secrets.write` (409 `reserved_name`); runtime filters reserved names at injection time even if they somehow appeared in vault (defense in depth — FR-014).
- **No vault.versions UI**: the dashboard shows current values only. Vault rows have native versioning via `updated_at`; future enhancement could surface history.
