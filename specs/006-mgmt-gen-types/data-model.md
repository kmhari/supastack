# Phase 1: Data Model

**Feature**: 006-mgmt-gen-types

This feature is read-mostly against existing per-instance Postgres state. The only new control-plane storage is one table (`restore_jobs`) supporting US4's async restore lifecycle.

---

## NEW — `restore_jobs` (control-plane DB)

Tracks the lifecycle of one backup-restore operation per row.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` | Job identifier — also the `restore_job_id` returned to the CLI |
| `instance_ref` | varchar(20) | NOT NULL, FK → `supabase_instances.ref` ON DELETE CASCADE | The project being restored |
| `backup_id` | uuid | NOT NULL, FK → `backups.id` ON DELETE RESTRICT | The snapshot being restored from |
| `status` | text | NOT NULL, CHECK IN (`'pending'`, `'running'`, `'success'`, `'failed'`), default `'pending'` | Lifecycle state |
| `started_at` | timestamptz | NULL | Set when worker transitions to `running` |
| `completed_at` | timestamptz | NULL | Set when status reaches terminal (`success` or `failed`) |
| `error_message` | text | NULL | Populated on `failed` |
| `actor_id` | uuid | NOT NULL, FK → `users.id` | Who initiated the restore |
| `pre_restore_dir` | text | NULL | Filesystem path to the rollback snapshot, e.g. `/var/selfbase/instances/<ref>/volumes/db/data.pre-restore-<id>`. Set when running, cleared after GC (24h post-success). |
| `timeout_budget_seconds` | integer | NOT NULL | Dynamic worker budget computed at job creation: `300 + ceil(backup_bytes / 1e9) * 60 + 300`. Worker aborts and runs rollback if exceeded. |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**Indexes**:
- `idx_restore_jobs_instance_ref ON (instance_ref)` — for "show me restore history for this project"
- `idx_restore_jobs_status_created ON (status, created_at)` — for the GC sweep (find old success/failed rows to clean up `pre_restore_dir`)
- `uq_restore_jobs_one_inflight ON (instance_ref) WHERE status IN ('pending', 'running')` — partial unique, enforces FR-019 + Decision 7

**Lifecycle / state machine**:

```
            (POST /restore-pitr)
                    ↓
             [ pending ]
                    │ worker picks up job
                    ↓
             [ running ]    started_at = now()
                    ├─→ success: stopped → data dir swapped → restarted → smoke probe OK
                    │      completed_at = now(), pre_restore_dir retained 24h then GC
                    └─→ failed: any step errors
                           rollback: data dir swapped back, project restarted from pre_restore_dir
                           completed_at = now(), error_message populated
```

**RLS**: control-plane DB has no RLS today; access enforced at the api layer via existing PAT + RBAC checks.

---

## EXISTING — `supabase_instances` (control-plane DB)

Add ONE column to support `pg-meta` reachability for the gen-types endpoint:

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `port_meta` | integer | NULL (backfill in same migration) | Host-mapped port for the per-instance `pg-meta` container, used by gen-types to call its TS-emit endpoint. Allocated by the existing port-allocator service alongside `port_kong`, `port_studio`, etc. |

**Migration**:
- Add column nullable.
- Backfill existing rows by reading `docker port selfbase-<ref>-meta-1` (worker one-shot, similar to feature 005's backfill-pooler-tenants).
- New instances populate it during provision (compose-template change).
- Drop NOT NULL constraint in a follow-up after all instances populated.

Also add a new `status` value:

| Status | Meaning |
|---|---|
| `restoring` | A restore is in flight; dashboard disables destructive ops; existing reconciler (after this feature's update) leaves it alone |

Update `apps/worker/src/jobs/health-reconciler.ts` to skip `restoring` rows just like it already skips `deleting` + grace-period `provisioning`.

---

## EXISTING — `backups` (control-plane DB)

No schema changes. Read-only consumption by `GET /v1/projects/<ref>/database/backups`.

---

## EXISTING — `audit_log` (control-plane DB)

No schema changes. Add new `event_type` values (string field, no enum) per Decision 9:
- `mgmt_api.migration.upsert`
- `mgmt_api.migration.delete`
- `mgmt_api.backup.restore_started`
- `mgmt_api.backup.restore_completed`
- `mgmt_api.backup.restore_failed`

---

## EXISTING — per-instance Postgres (read by api, never modified by these endpoints)

### `supabase_migrations.schema_migrations`

| Column | Type | Notes |
|---|---|---|
| `version` | text | 14-digit timestamp string, PK |
| `name` | text | Migration name (nullable for legacy rows) |
| `statements` | text[] | SQL statements (nullable for legacy rows) |

Lazily created by the api on first call per Decision 3.

### `user_content.content` (Studio's snippet storage)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | Snippet title |
| `description` | text | Optional description |
| `content` | text | SQL body |
| `owner_id` | uuid | Studio user who created it |
| `visibility` | text | `user|project|org` |
| `type` | text | `sql` typically; other values ignored by the API |
| `inserted_at` | timestamptz | |
| `updated_at` | timestamptz | |

Provided by Studio; not modified by this feature. If the schema doesn't exist, the api treats the project as having zero snippets (FR-015).

---

## Cross-feature touch points

- **Feature 005's `pooler_tenants` table**: unaffected. Restore stops + restarts the per-instance PG; supavisor will see a brief connection error then reconnect.
- **Feature 005's `pg_edge_certs` table**: unaffected. The per-project cert remains valid across restore — no cert rotation needed.
- **Feature 004's `wildcard_certs` table**: unaffected.

---

## Entity relationship diagram (text)

```
supabase_instances (existing)
        │
        ├──< backups (existing)
        │       │
        │       └──< restore_jobs (NEW)
        │               │
        │               └─→ users (existing) via actor_id
        │
        └── per-instance PG (out of band)
                ├── supabase_migrations.schema_migrations  (US2 reads/writes)
                └── user_content.content                   (US3 reads only)

per-instance pg-meta container (out of band)
        └── /types/typescript                              (US1 forwards)
```
