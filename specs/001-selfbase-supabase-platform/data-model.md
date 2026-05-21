# Phase 1 — Data Model

Single Postgres database backing the selfbase control plane. All migrations are idempotent (Drizzle `migrate()` + idempotent SQL). Naming uses `snake_case`; types reflect Drizzle column kinds.

```text
       ┌─────────┐        ┌──────────────┐
       │  org    │1──────*│  org_members │*──────1┌────────┐
       │ (one)   │        └──────────────┘        │ users  │
       └────┬────┘                                └────┬───┘
            │1                                         │1
            │*                                         │*
       ┌────▼──────────────┐                  ┌────────▼────┐
       │supabase_instances │1──*┐             │ api_tokens  │
       └────┬──────────────┘    │             └─────────────┘
            │1                  │1
            │*                  │*
       ┌────▼────┐          ┌───▼──────────────┐
       │ backups │          │ port_allocations │
       └─────────┘          └──────────────────┘
                                  audit_log (cross-cutting)
                                  setup_state (singleton)
```

## Tables

### `org` *(singleton — exactly one row after setup)*

| column | type | notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `name` | text NOT NULL | display name |
| `apex_domain` | text NULL UNIQUE | the configured apex (e.g., `selfbase.example.com`) |
| `backup_store_kind` | text NOT NULL DEFAULT `'local'` | enum `('local','s3')` via check constraint |
| `backup_store_config_encrypted` | bytea NULL | AES-GCM blob: `{ endpoint?, bucket?, region?, accessKeyId?, secretAccessKey? }` |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` |
| `updated_at` | timestamptz NOT NULL DEFAULT `now()` |

Singleton constraint: a partial unique index over the constant expression `1` allows at most one row to exist:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS org_singleton ON org ((1::int));
```

The row is created during `/setup`; subsequent inserts fail with a unique-constraint violation. This is intentionally enforced at the DB layer in addition to the app-level "create once" guard so that no code path (worker, future CLI/MCP, manual psql) can produce a second org.

### `users`

| column | type | notes |
|---|---|---|
| `id` | uuid PK |
| `email` | citext NOT NULL UNIQUE |
| `hashed_password` | text NOT NULL | Argon2id `$argon2id$...` |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` |
| `updated_at` | timestamptz NOT NULL DEFAULT `now()` |

### `org_members`

| column | type | notes |
|---|---|---|
| `org_id` | uuid NOT NULL FK → `org.id` ON DELETE CASCADE |
| `user_id` | uuid NOT NULL FK → `users.id` ON DELETE CASCADE |
| `role` | text NOT NULL CHECK in (`'admin','member'`) |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` |
| PRIMARY KEY | (`org_id`, `user_id`) |

State transitions: invite (`invites` row) → accept → insert into `org_members`. Removal = delete row + invalidate sessions and tokens via cascade.

### `invites`

| column | type | notes |
|---|---|---|
| `id` | uuid PK |
| `org_id` | uuid NOT NULL FK → `org.id` |
| `email` | citext NOT NULL |
| `token_sha256` | bytea NOT NULL UNIQUE | the URL token's SHA-256 (raw token shown once) |
| `role` | text NOT NULL CHECK in (`'admin','member'`) |
| `invited_by_user_id` | uuid NOT NULL FK → `users.id` |
| `expires_at` | timestamptz NOT NULL | 24h after `created_at` |
| `consumed_at` | timestamptz NULL | set on accept |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` |

Index on (`token_sha256`); index on (`email`, `consumed_at`) for "is there an open invite for this email".

### `api_tokens`

| column | type | notes |
|---|---|---|
| `id` | uuid PK |
| `user_id` | uuid NOT NULL FK → `users.id` ON DELETE CASCADE |
| `token_sha256` | bytea NOT NULL UNIQUE | raw token shown once at creation |
| `label` | text NOT NULL | e.g., "ci-deploy" |
| `last_used_at` | timestamptz NULL |
| `revoked_at` | timestamptz NULL |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` |

Index on (`user_id`, `revoked_at`).

### `setup_state` *(singleton)*

| column | type | notes |
|---|---|---|
| `id` | int PK DEFAULT 1 CHECK (`id = 1`) |
| `completed_at` | timestamptz NULL |

`completed_at` is non-null once first-time setup has succeeded. The open setup endpoint refuses requests after `completed_at IS NOT NULL`.

### `supabase_instances`

| column | type | notes |
|---|---|---|
| `ref` | text PK | 20 lowercase alphanumerics, immutable |
| `org_id` | uuid NOT NULL FK → `org.id` |
| `name` | text NOT NULL | editable display name |
| `status` | text NOT NULL CHECK in (`'provisioning','running','paused','stopped','failed','deleting'`) |
| `supabase_version` | text NOT NULL | upstream pinned version, e.g., `2026.05.01` |
| `encrypted_secrets` | bytea NOT NULL | AES-GCM `iv || ct || tag`; plaintext is JSON: `{ jwt_secret, anon_key, service_role_key, postgres_password, dashboard_password }` |
| `port_kong` | int NOT NULL UNIQUE |
| `port_studio` | int NOT NULL UNIQUE |
| `port_postgres` | int NOT NULL UNIQUE |
| `port_pooler` | int NOT NULL UNIQUE |
| `port_analytics` | int NOT NULL UNIQUE |
| `create_smtp_host` | text NULL |
| `create_smtp_port` | int NULL |
| `create_smtp_user` | text NULL |
| `create_smtp_pass_encrypted` | bytea NULL | AES-GCM blob — separate so a future granular reveal can target only SMTP |
| `create_enable_signup` | boolean NOT NULL DEFAULT `true` |
| `create_jwt_expiry_sec` | int NOT NULL DEFAULT 3600 |
| `backup_auto_enabled` | boolean NOT NULL DEFAULT `true` |
| `backup_retain` | int NOT NULL DEFAULT 7 CHECK (`backup_retain >= 1`) |
| `last_backup_at` | timestamptz NULL | informational cache; canonical source is `backups` table |
| `provision_error` | text NULL | populated when status='failed' |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` |
| `updated_at` | timestamptz NOT NULL DEFAULT `now()` |

State machine:

```text
                ┌─→ provisioning ─→ running ⇄ paused
create ─────────┤        │           │   │
                │        ▼           │   ▼
                │      failed        │  stopped (rare: container died)
                │                    ▼
                └─────────────→  deleting → (row removed)
```

Allowed transitions: `provisioning→running`, `provisioning→failed`, `running→paused`, `paused→running`, `running→stopped` (only when worker observes containers exited unexpectedly), `*→deleting`, `deleting→(deleted)`.

### `port_allocations`

| column | type | notes |
|---|---|---|
| `port` | int PK | the actual port number |
| `kind` | text NOT NULL CHECK in (`'kong','studio','postgres','pooler','analytics'`) |
| `instance_ref` | text NULL FK → `supabase_instances.ref` ON DELETE SET NULL | NULL only briefly during atomic delete |

Insert-on-create / delete-on-instance-delete. The PK on `port` prevents collisions; the worker retries on conflict.

### `backups`

| column | type | notes |
|---|---|---|
| `id` | uuid PK |
| `instance_ref` | text NOT NULL FK → `supabase_instances.ref` ON DELETE CASCADE |
| `kind` | text NOT NULL CHECK in (`'manual','auto'`) |
| `status` | text NOT NULL CHECK in (`'running','completed','failed'`) |
| `store_kind` | text NOT NULL CHECK in (`'local','s3'`) |
| `store_key` | text NOT NULL | path or S3 key |
| `size_bytes` | bigint NULL | populated on completed |
| `error` | text NULL |
| `started_at` | timestamptz NOT NULL DEFAULT `now()` |
| `completed_at` | timestamptz NULL |

Index on (`instance_ref`, `started_at DESC`) for the retention sweep.

### `audit_log`

| column | type | notes |
|---|---|---|
| `id` | bigserial PK |
| `actor_user_id` | uuid NULL FK → `users.id` | null only for system actions (scheduler) |
| `action` | text NOT NULL | e.g., `'instance.delete'`, `'secret.reveal'`, `'member.remove'`, `'token.revoke'` |
| `target_kind` | text NULL | `'instance' | 'user' | 'token' | 'org'` |
| `target_id` | text NULL |
| `payload` | jsonb NOT NULL DEFAULT `'{}'::jsonb` |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` |

Immutable in the application layer (no UPDATE/DELETE statements issued).

## Cardinality / invariants

- Exactly one `org` row after setup (enforced by `setup_state` + app guard).
- Every `supabase_instances` row has exactly 5 `port_allocations` rows referencing it.
- Every running instance has a corresponding Caddy route entry derived from `(ref, port_kong, port_studio)` — not a DB invariant per se, but the worker enforces it on every reload.
- An invite is consumable at most once: `consumed_at` is set on accept; subsequent attempts fail the "open invite" lookup.
- An `api_tokens.token_sha256` value can only be matched on lookup; the raw token is never persisted.

## Migrations

Stored under `packages/db/migrations/`. Each migration is idempotent (uses `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS` etc.). Drizzle's snapshot file checked in for parity with code.

Initial migration sequence:

1. `0000_identity.sql` — `org`, `users`, `org_members`, `invites`, `api_tokens`, `setup_state`
2. `0001_instances.sql` — `supabase_instances`, `port_allocations`
3. `0002_backups.sql` — `backups`
4. `0003_audit.sql` — `audit_log`
