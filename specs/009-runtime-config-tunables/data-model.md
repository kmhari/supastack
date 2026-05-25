# Data Model — Feature 009: Runtime config tunables

## New entity

### `project_config_snapshots`

One row per `(instance_ref, surface)` pair. Holds the post-merge encrypted JSON snapshot that GET serves and that PATCH merges against (for the sentinel-merge of secret fields).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | `uuid` | PK, default `gen_random_uuid()` | Surrogate key |
| `instance_ref` | `text` | NOT NULL, references `instances(ref)` ON DELETE CASCADE | Per-project FK |
| `surface` | `text` | NOT NULL, CHECK (`surface` IN (`'postgrest'`, `'auth'`)) | Which endpoint group |
| `encrypted_payload` | `bytea` | NOT NULL | `encryptJson(<full config JSON>, masterKey)` |
| `version` | `bigint` | NOT NULL, default 1 | Bumped on every successful PATCH (optimistic-concurrency hint; not strictly required given the Redis lock, but cheap and useful for audit) |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | First PATCH timestamp |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Last PATCH timestamp |
| `updated_by` | `uuid` | references `users(id)` ON DELETE SET NULL | Last writer |

**Indexes**:
- `UNIQUE (instance_ref, surface)` — one row per surface per project.

**Lifecycle**:
- **GET** with no row: return upstream-documented defaults (computed in `runtime-config-store.ts::defaultConfigFor(surface)`); do not lazy-create a row (a row exists only after at least one PATCH).
- **PATCH** first time on a surface: INSERT.
- **PATCH** subsequent: UPDATE, bump `version`, set `updated_at`/`updated_by`.
- **Instance delete**: ON DELETE CASCADE removes both surface rows.

**Migration** (`packages/db/migrations/0009_project_config_snapshots.sql`):

```sql
CREATE TABLE IF NOT EXISTS project_config_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref text NOT NULL,
  surface text NOT NULL,
  encrypted_payload bytea NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_config_snapshots_surface_check'
  ) THEN
    ALTER TABLE project_config_snapshots
      ADD CONSTRAINT project_config_snapshots_surface_check
      CHECK (surface IN ('postgrest', 'auth'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_config_snapshots_instance_ref_fkey'
  ) THEN
    ALTER TABLE project_config_snapshots
      ADD CONSTRAINT project_config_snapshots_instance_ref_fkey
      FOREIGN KEY (instance_ref) REFERENCES instances(ref) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_config_snapshots_updated_by_fkey'
  ) THEN
    ALTER TABLE project_config_snapshots
      ADD CONSTRAINT project_config_snapshots_updated_by_fkey
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS project_config_snapshots_unique
  ON project_config_snapshots(instance_ref, surface);
```

(Idempotent — repeat runs are a no-op.)

## Modified entity

### `audit_log` (existing)

No schema change. This feature emits new `action` values:

| `action` | When |
|---|---|
| `mgmt_api.postgrest.update` | After a successful `PATCH /v1/projects/<ref>/postgrest` |
| `mgmt_api.auth_config.update` | After a successful `PATCH /v1/projects/<ref>/config/auth` |

**Payload shape** (jsonb):

```json
{
  "ref": "<instance_ref>",
  "surface": "postgrest" | "auth",
  "changed_fields": ["jwt_exp", "external_google_secret"],
  "diff": {
    "jwt_exp": { "old": 3600, "new": 86400 },
    "external_google_secret": { "old": "***", "new": "***" }
  }
}
```

**Redaction in audit**: secret-typed fields have BOTH old and new redacted to `***` in the audit `diff` — the audit log MUST NOT leak plaintext secrets. The fact that a secret changed is recorded; the value is not.

## Touched RBAC matrix

`packages/shared/src/rbac.ts` — append 4 entries to `ACTIONS`:

```ts
// feature 009 — runtime config tunables
'data_api_config.read',
'data_api_config.write',
'auth_config.read',
'auth_config.write',
```

Matrix rows:

| Role | `data_api_config.read` | `data_api_config.write` | `auth_config.read` | `auth_config.write` |
|---|---|---|---|---|
| `admin` | true | true | true | true |
| `member` | true | false | true | false |

## Entities NOT changed

- `projectSecrets` (feature 003) — untouched. Different surface (per-project user secrets vs config-level secrets).
- `instances` — referenced via FK but not modified.
- Per-instance `.env` files — written by this feature for honored fields only (see `env-field-mapper.ts`); no new file format, just additional `KEY=value` lines via the existing `upsertEnvEntry` helper.
