# Data Model: Supabase CLI Compatibility — P0

**Feature**: `003-supabase-cli-compat-p0` | **Date**: 2026-05-22

This phase enumerates the entities the feature touches, the new tables it introduces, and the migration that brings the control-plane DB to the post-feature shape. All schema deltas are idempotent (per the user's standing rule in `CLAUDE.md`).

---

## Entities

### Reused (no schema change needed)

| Entity | Source | Role in this feature |
|---|---|---|
| `users` | existing | The subject of a PAT. `apiTokens.userId` → `users.id`. Every authenticated management-API call resolves to a row here. |
| `supabaseInstances` | existing | The "project" entity, addressed by `ref`. Every per-project management endpoint scopes by `:ref` → `supabaseInstances.ref`. |
| `organizations` | existing | Returned by `GET /v1/organizations`. The CLI uses this to populate org pickers. |

### Reused, modified

#### `apiTokens` — token format change

The table already exists. The plaintext token format is what changes. A small schema delta adds a `prefix` column for the dashboard list view.

```sql
-- Migration 0002_cli_compat.sql (idempotent)
ALTER TABLE api_tokens
  ADD COLUMN IF NOT EXISTS prefix text;

-- For pre-existing rows (old sb_ format), leave NULL — they're dashboard-only
-- and the new Tokens UI will render them as "(legacy)" without exposing the prefix.

CREATE INDEX IF NOT EXISTS api_tokens_prefix_idx ON api_tokens (prefix)
  WHERE prefix IS NOT NULL;
```

**Service-level rule**: `mintApiToken` writes `prefix = raw.slice(0, 12)` (e.g. `sbp_e4cebad5`) at insert time. Old tokens stay valid until manually revoked.

**Constraint**: every plaintext PAT MUST match `^sbp_[a-f0-9]{40}$`. Enforced by the regex inside the service function, not at the DB layer (the DB only sees the hash).

---

### New tables

#### `project_functions` — deployed-function metadata per instance

Tracks every edge function deployed by any client (CLI or future dashboard UI) to a per-instance volume. The bundle itself lives on the host filesystem at `/var/supastack/instances/<ref>/volumes/functions/<slug>/`; this table is the canonical index.

```sql
CREATE TABLE IF NOT EXISTS project_functions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref    text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  slug            text        NOT NULL,
  name            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'ACTIVE'
                                CHECK (status IN ('ACTIVE', 'REMOVED')),
  verify_jwt      boolean     NOT NULL DEFAULT true,
  version         integer     NOT NULL DEFAULT 1,
  entrypoint_path text,
  import_map_path text,
  source_path     text        NOT NULL,
                                -- relative to per-instance volume; e.g. "hello/source.eszip"
  size_bytes      bigint      NOT NULL,
  sha256          text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (instance_ref, slug)
);

CREATE INDEX IF NOT EXISTS project_functions_active_idx
  ON project_functions (instance_ref, status)
  WHERE status = 'ACTIVE';
```

**Notes**:
- `slug` is the CLI-facing identifier. Must match `^[a-z0-9][a-z0-9-]{0,47}$` (DNS-label-ish, ≤48 chars; the upstream CLI enforces a similar rule before upload).
- `status='REMOVED'` is a soft-delete used briefly after `DELETE /v1/.../functions/:slug`, retained for ~30s for audit/debugging then hard-deleted by the worker. The `UNIQUE (instance_ref, slug)` constraint means a re-deploy after delete is a fresh row, not a resurrection. *(Implementation note: easier to do hard-delete inline — only soft-delete if we observe a need for the audit trail.)*
- `version` increments on every PUT. The CLI doesn't currently consume versions, but they're free here and useful for the deploy-audit log.
- `sha256` of the bundle helps detect identical re-uploads (skip restart if hash unchanged — optimization, not P0-required). On the eszip path, this equals `ezbr_sha256` (the CLI computes the same value client-side and uses it for the skip-no-change check on subsequent deploys). On the `--use-api` path, it's our own SHA-256 over the sorted `(filename, contents)` pairs.
- `source_path` records which on-disk form the bundle takes: `bundle.eszip` for eszip-path deploys (default `supabase functions deploy` flow), `index.ts` (or whatever the entrypoint filename is) for `--use-api` deploys. The per-instance edge-runtime's `main` router consults a sidecar `meta.json` to decide whether to load via `EdgeRuntime.userWorkers.create({ maybeEszip, ... })` or via `servicePath`-based directory loading.

#### `function_deploys` — deploy audit log

One row per successful or failed deploy attempt. Useful for the dashboard's per-function history view and for debugging failed deploys (which the CLI rarely surfaces in detail).

```sql
CREATE TABLE IF NOT EXISTS function_deploys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  function_id   uuid        REFERENCES project_functions(id) ON DELETE CASCADE,
  instance_ref  text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  slug          text        NOT NULL,
  version       integer     NOT NULL,
  status        text        NOT NULL
                              CHECK (status IN ('SUCCEEDED', 'FAILED', 'ROLLED_BACK')),
  size_bytes    bigint,
  sha256        text,
  error_message text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  deployed_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  source        text        NOT NULL
                              CHECK (source IN ('cli', 'dashboard', 'api'))
);

CREATE INDEX IF NOT EXISTS function_deploys_instance_idx
  ON function_deploys (instance_ref, started_at DESC);
```

**Notes**:
- `function_id` is nullable (`ON DELETE CASCADE`) so deploys to brand-new slugs that subsequently get deleted still leave their history. *(Reconsider: if cascade nukes them, history is lost — change to `ON DELETE SET NULL` if we want long-lived history. Defer this decision; P0 doesn't expose history to the CLI.)*

#### `project_secrets` — secret index + encrypted values

Source of truth for which secrets are configured per project, encrypted at rest. The live runtime value lives in `/var/supastack/instances/<ref>/.env`; this table lets us rebuild that file after a restore and lets the dashboard list secret names without re-reading the disk.

```sql
CREATE TABLE IF NOT EXISTS project_secrets (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref      text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  name              text        NOT NULL,
  encrypted_value   bytea       NOT NULL,
                                  -- @supastack/crypto encryptJson({value}, masterKey)
  value_sha256      text        NOT NULL,
                                  -- SHA-256 hex digest of plaintext value
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_by        uuid        REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (instance_ref, name)
);
```

**Constraints**:
- `name` must match `^[A-Z][A-Z0-9_]{0,63}$` (enforced in `secret-store.ts`, not at the DB layer — easier to evolve).
- `name` MUST NOT be in `RESERVED_SECRET_NAMES` (see research.md R-005). Enforced before insert.
- `encrypted_value` is the per-instance master-key-encrypted JSON `{ "value": "..." }`. Decryption is performed only when writing the `.env` file or restoring from backup; the dashboard's list endpoint never decrypts.
- `value_sha256` is a non-reversible per-row indicator (hex SHA-256 of the plaintext value), computed at write-time. The redacted-list response for FR-015 (`GET /v1/projects/:ref/secrets`) surfaces it directly so the dashboard and CLI can render a stable per-secret fingerprint **without decrypting per-call**. Plaintext is recoverable only via the encrypted blob; this column is safe to expose.

---

## State transitions

### Function deploy lifecycle

```
                          ┌─────────────────────────────────────┐
                          │                                     │
                          ▼                                     │
[no row] ──POST──► [pending] ──restart-ok──► [ACTIVE v=N] ──PUT─┘
              │       │                          │
              │       │                          │
              │       └──restart-fail──► [pending then rolled-back, row removed]
              │
              └──delete──► [REMOVED] ──30s──► [hard-deleted]
```

- **[pending]** is implicit, not a persisted status — it exists for the duration of the deploy request handler. The DB row is INSERTed only after the bundle is on disk and the container restart is initiated.
- **[ACTIVE v=N]** is the normal post-deploy state. The `version` increments on every successful PUT.
- **[rolled-back]** means the restart failed and we restored the prior bundle (or removed the file if it was the first deploy). The DB row is rolled back in the same transaction as the file write (transactional outbox pattern — we write the file inside the DB transaction's `BEGIN…COMMIT`, and on failure we both rollback the row and remove the file).
- **[REMOVED] → [hard-deleted]** is a soft-delete window we can choose to skip; see project_functions notes.

### Secret lifecycle

```
[absent] ──POST set──► [present, encrypted] ──container-restart-ok──► [LIVE]
                              │                                            │
                              │                                            │
                              └──restart-fail──► [absent, row rolled back, error returned]

[LIVE] ──POST set (same name)──► overwrite, value re-encrypted, restart
[LIVE] ──DELETE──► [absent] ──restart-ok──► [GONE]
```

**Atomicity rule**: the DB transaction wraps the .env file edit; on rollback we restore the file from a backup copy taken at the start of the request. Concurrent CLI calls are serialized by a per-instance lock (Redis `SETNX` with 30s TTL, key `supastack:secret-lock:<ref>`).

---

## Validation rules summary

| Field | Rule | Enforced by |
|---|---|---|
| `apiTokens.prefix` | First 12 chars of plaintext token | `mintApiToken` service |
| plaintext PAT | `^sbp_[a-f0-9]{40}$` | `mintApiToken` service (supastack) AND CLI client-side regex (validated externally) |
| `project_functions.slug` | `^[a-z0-9][a-z0-9-]{0,47}$` | `function-deploy.ts` service |
| `project_secrets.name` | `^[A-Z][A-Z0-9_]{0,63}$` AND NOT IN reserved list | `secret-store.ts` service |
| function bundle size | ≤ 50 MB per upload | `@fastify/multipart` config |
| `function_deploys.status` | One of three values | DB CHECK |
| `project_functions.status` | One of two values | DB CHECK |

---

## Relationships diagram

```
                ┌──────────────┐
                │    users     │
                └──────┬───────┘
                       │
        ┌──────────────┼───────────────────┐
        │              │                   │
        ▼              ▼                   ▼
 ┌────────────┐  ┌──────────────────┐  ┌─────────────────┐
 │ apiTokens  │  │ project_functions│  │ project_secrets │
 │ +prefix    │  │                  │  │                 │
 └────────────┘  └────┬─────────────┘  └────┬────────────┘
                      │                     │
                      │     ┌───────────────┘
                      │     │
                      ▼     ▼
                 ┌─────────────────────┐
                 │ supabase_instances  │  ← addressed by `ref` in every per-project endpoint
                 │  (per-instance      │
                 │  edge-runtime       │
                 │  container +        │
                 │  /var/supastack/.../ │
                 │  volumes/functions/ │
                 │  + .env)            │
                 └─────────────────────┘
                            ▲
                            │
                    ┌────────────────────┐
                    │ function_deploys   │  ← audit log, one per attempt
                    └────────────────────┘
```

---

## Migration: `packages/db/migrations/0002_cli_compat.sql`

Single idempotent file:

```sql
-- 0002_cli_compat.sql — adds tables and columns for Supabase CLI compatibility (P0).
-- Safe to run multiple times.

-- 1. Token prefix column for the new sbp_ format
ALTER TABLE api_tokens
  ADD COLUMN IF NOT EXISTS prefix text;
CREATE INDEX IF NOT EXISTS api_tokens_prefix_idx ON api_tokens (prefix) WHERE prefix IS NOT NULL;

-- 2. Edge functions per instance
CREATE TABLE IF NOT EXISTS project_functions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref    text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  slug            text        NOT NULL,
  name            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'ACTIVE'
                                CHECK (status IN ('ACTIVE', 'REMOVED')),
  verify_jwt      boolean     NOT NULL DEFAULT true,
  version         integer     NOT NULL DEFAULT 1,
  entrypoint_path text,
  import_map_path text,
  source_path     text        NOT NULL,
  size_bytes      bigint      NOT NULL,
  sha256          text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (instance_ref, slug)
);
CREATE INDEX IF NOT EXISTS project_functions_active_idx
  ON project_functions (instance_ref, status) WHERE status = 'ACTIVE';

-- 3. Deploy audit log
CREATE TABLE IF NOT EXISTS function_deploys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  function_id   uuid        REFERENCES project_functions(id) ON DELETE CASCADE,
  instance_ref  text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  slug          text        NOT NULL,
  version       integer     NOT NULL,
  status        text        NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED', 'ROLLED_BACK')),
  size_bytes    bigint,
  sha256        text,
  error_message text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  deployed_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  source        text        NOT NULL CHECK (source IN ('cli', 'dashboard', 'api'))
);
CREATE INDEX IF NOT EXISTS function_deploys_instance_idx
  ON function_deploys (instance_ref, started_at DESC);

-- 4. Per-instance secrets index
CREATE TABLE IF NOT EXISTS project_secrets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref    text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  name            text        NOT NULL,
  encrypted_value bytea       NOT NULL,
  value_sha256    text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (instance_ref, name)
);
-- value_sha256 was added in a follow-up; the shipped migration also includes
-- a defensive ADD COLUMN IF NOT EXISTS + backfill block so re-runs against
-- migrated DBs converge to the same schema. See the actual migration file
-- packages/db/migrations/0002_cli_compat.sql for the idempotent version.
```

The Drizzle schema in `packages/db/src/schema.ts` is updated in parallel to mirror these tables. The migration is the source of truth; the Drizzle schema is a typed mirror.
