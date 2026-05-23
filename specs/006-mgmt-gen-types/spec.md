# Feature Specification: Supabase CLI — `gen types` + `migration *` + `snippets *` + `backups list/restore`

**Feature Branch**: `006-cli-mgmt-tier1` (kept for git history; see `.specify/feature.json` for the active directory)

**Created**: 2026-05-23

**Status**: Draft

**Input**: User descriptions:
1. "pick up issue #4, scope to just gen types" — narrows the earlier Tier 1 group (issue #4) to its single highest-demand endpoint
2. "lets add supabase migrations * to the spec" — extends scope to the full `supabase migration` CLI subcommand family
3. "lets add supabase snippets * and supabase backups list/restore to the spec; FYI here is the management API SPECS https://api.supabase.com/api/v1-json" — extends scope to two more CLI surfaces. The OpenAPI spec URL is the authoritative shape reference for the new endpoints.

Sibling endpoint groups still split out as low-priority issues:
- Custom domains → issue #10
- postgrest + auth runtime config → issue #11
- ssl-enforcement → issue #12

## Background

selfbase already implements the P0 subset of Supabase's Management API (shipped in feature 003): the endpoints the upstream Supabase CLI calls for `supabase login`, `supabase link`, `supabase functions deploy/list/download/delete`, and `supabase secrets set/list/unset`. Feature 005 unblocked `supabase db push/pull/diff` by exposing per-instance Postgres at `db.<ref>.<apex>:5432` and a multi-tenant pooler at `pooler.<apex>:6543`.

This feature replaces the `501 not_implemented` response for four more CLI surfaces:

| User Story | CLI | Priority | Why |
|---|---|---|---|
| US1 | `supabase gen types typescript` | P1 | Every TypeScript-based Supabase project calls this in its build step |
| US2 | `supabase migration *` (list/repair/fetch — `up` already works via feature 005) | P1 | Canonical day-2 schema-evolution workflow |
| US3 | `supabase snippets list/download` | P3 | SQL editor snippet portability — niche but cheap to add |
| US4 | `supabase backups list` + `supabase backups restore` | P2 | Disaster-recovery surface; list is cheap, restore is heavy but high-value |

Out of scope: arbitrary-SQL `POST /v1/projects/<ref>/database/query` (security-sensitive, own spec); all other Tier 1/2/3 endpoints.

## Clarifications

### Session 2026-05-23

Scoped to US4 (backups list/restore).

- Q: When restore can't take the pre-restore snapshot (insufficient disk), what's the behavior? → A: Pre-flight check. Reject with `409 disk_space_insufficient` before any state is touched, including a message stating how much more free space is needed (estimated `2 × existing data_dir size`).
- Q: What happens to the other per-instance containers (auth, rest, storage, realtime, edge functions) during restore? → A: Stop them all before the swap, restart them after Postgres is back to healthy. Clean state; clients see consistent unreachability during the restore window rather than per-service transient errors.
- Q: What's the absolute timeout for the restore worker? → A: Dynamic, scaled to backup size. Formula: `5 min base + 1 min per GB of backup blob + 5 min final healthcheck`. Worker marks job `failed` with `timeout_exceeded` and runs rollback if the budget is exhausted.
- Q: How long is the pre-restore snapshot dir retained after a successful restore? → A: 24 hours fixed, then GC'd by a scheduled BullMQ job.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Generate TypeScript types for a project (Priority: P1)

A developer is wiring up a TypeScript app against their self-hosted Supabase project. They run `supabase gen types typescript --project-id <ref> --schema public > database.types.ts` and get a TypeScript source file with exact types for every table, view, enum, and function — identical in shape to what Supabase Cloud emits, so the rest of the SDK type ergonomics work unchanged.

**Why this priority**: Highest user demand. Without it, every TypeScript Supabase project on selfbase loses static type safety.

**Independent Test**: `supabase gen types typescript --project-id <existing-ref>` exits 0, emits valid TypeScript that compiles under `tsc --noEmit`, and includes a `Database` type listing all user tables.

**Acceptance Scenarios**:

1. **Given** a project exists with at least one user-defined table in `public`, **When** the CLI generates types, **Then** the emitted file declares that table under `Database.public.Tables.<tableName>` with correct columns, types, nullability, and Row/Insert/Update variants.
2. **Given** `--schema public --schema auth`, **When** types are generated, **Then** both schemas appear in the emitted file under `Database.<schema>`.
3. **Given** an invalid project ref, **When** the CLI requests types, **Then** the response is 404 with the standard error envelope.
4. **Given** the requester is unauthenticated, **When** the endpoint is called without a valid PAT, **Then** the response is 401.
5. **Given** the requester is authenticated but lacks access, **When** the endpoint is called, **Then** the response is 403.

---

### User Story 2 — Manage database migrations end-to-end from CLI (Priority: P1)

A developer working against a self-hosted selfbase project wants the same migration workflow they'd have against Supabase Cloud: create a new migration locally (`supabase migration new`), push it (`supabase migration up`), list the project's history side-by-side with their local files (`supabase migration list`), repair drift if the history table got out of sync (`supabase migration repair`), or pull the remote history back to local (`supabase migration fetch`). All commands work with only `--project-ref` — no `--db-url` flag required.

**Why this priority**: Migration is the canonical day-2 workflow for every Supabase project. Half the operations are local-only, the other half need a small API surface to read and patch the history table.

**Independent Test**: From a linked project: `migration new` → edit SQL → `migration up` → `migration list` shows applied → manually delete the row → `migration repair --status applied` → `migration list` shows applied again → `migration fetch` reconstructs local files.

**Acceptance Scenarios**:

1. **Given** a freshly linked project with no migrations, **When** `supabase migration list` runs, **Then** the response shows zero applied and zero local migrations.
2. **Given** a local migration file `20260520120000_add_users_table.sql`, **When** `supabase migration up` runs, **Then** the migration is applied and a row appears in `supabase_migrations.schema_migrations`.
3. **Given** the migration above is applied, **When** `supabase migration list` runs, **Then** `20260520120000` is listed as Applied in both Local and Remote columns.
4. **Given** the row was manually removed (simulating drift), **When** `supabase migration repair 20260520120000 --status applied` runs, **Then** the row is restored.
5. **Given** an applied migration the developer wants reverted, **When** `supabase migration repair 20260520120000 --status reverted` runs, **Then** the row is removed.
6. **Given** N applied migrations recorded only remotely, **When** `supabase migration fetch` runs, **Then** the local directory is populated with N migration files.
7. **Given** an invalid project ref or not-running project, **When** any migration subcommand is invoked, **Then** the CLI surfaces 404 or 409 via the standard error envelope.
8. **Given** an authenticated user without access, **When** any migration subcommand is invoked, **Then** the response is 403.

---

### User Story 3 — Import and export SQL editor snippets via CLI (Priority: P3) **— DEFERRED to issue #13**

> **Deferred during implementation**: the spec assumed `/v1/snippets` reads from `user_content.content` on the per-instance Postgres (mirroring Supabase Cloud). Live inspection of a selfbase project showed no such schema — selfbase Studio (OSS Supabase Studio) stores SQL snippets in browser localStorage, not server-side. Implementing the endpoints requires either a new control-plane snippets table + Studio integration, or waiting for upstream OSS Studio to add server-side snippet storage. Tracked in [#13](https://github.com/kmhari/selfbase/issues/13).
>

A developer maintains a collection of useful SQL snippets in the selfbase Studio SQL editor (queries for ops, ad-hoc reports, debugging joins). They want to list them from the CLI for backup or to copy into version control. They run `supabase snippets list` to see all their snippets across projects they have access to, then `supabase snippets download <snippet-id> > my-query.sql` to pull the body of a specific one to disk.

**Why this priority**: Niche but cheap. Snippet portability matters for developers who curate a personal query library; it's the difference between a one-off SQL Editor session and a reusable artifact. Implementation is a thin read-only wrapper over the per-instance `user_content` schema that Supabase Studio already populates.

**Independent Test**: Create a snippet via Studio in a test project. Run `supabase snippets list` — must include that snippet with its id, name, project ref, and updated-at. Run `supabase snippets download <id>` — must return the exact SQL body the user entered.

**Acceptance Scenarios**:

1. **Given** the user has access to one project and that project has two saved snippets, **When** `supabase snippets list` runs, **Then** the response is an array of exactly two snippet summaries, each including `id`, `name`, `description`, `project_ref`, `owner_id`, `inserted_at`, `updated_at`.
2. **Given** the user has access to multiple projects each with snippets, **When** `supabase snippets list` runs without a filter, **Then** the response aggregates snippets across all accessible projects.
3. **Given** the user passes `?project_ref=<ref>` on the list endpoint, **When** the call runs, **Then** the response is scoped to that project only.
4. **Given** a snippet id the user has access to, **When** `supabase snippets download <id>` runs, **Then** the response includes the snippet's full SQL `content` along with all summary fields.
5. **Given** a snippet id the user does NOT have access to (snippet owned by another user in a different project), **When** the call runs, **Then** the response is 404 (not 403 — we don't leak existence of unrelated snippets).
6. **Given** the user is unauthenticated, **When** the endpoints are called, **Then** the response is 401.

---

### User Story 4 — List and restore backups via CLI (Priority: P2) **— DEFERRED to issue #14**

> **Deferred from feature 006** as the heaviest piece (new restore_jobs entity, async BullMQ worker, filesystem-snapshot rollback, GC, RBAC gate, dynamic timeout, multiple pre-flight checks — ~11 tasks). All design work (FRs, contracts, data model, clarifications) is preserved here for the follow-up implementation. Tracked in [#14](https://github.com/kmhari/selfbase/issues/14).
>

An operator runs nightly snapshots of a production project (selfbase already supports this via the worker's backup job). When something goes wrong — a bad migration, an accidental `DELETE FROM users` — they need to restore. They run `supabase backups list --project-ref <ref>` to see available restore points, pick a recovery target, run `supabase backups restore --project-ref <ref> --backup-id <id>`, wait for the project to come back up, and verify data is at the chosen point in time.

**Why this priority**: Backups are the foundation of disaster recovery. selfbase already has the backup-write side; the list and restore-read side closes the loop. Restore is destructive and substantial work (stop the instance, replace the data directory, restart, verify) — gated to admins only with strong confirmation.

**Independent Test**: Take a backup via existing dashboard/cron. Run `supabase backups list --project-ref <ref>` — must include the backup with `id`, `inserted_at`, `status` (`COMPLETED`), and size. Make a destructive change to the data (e.g., `DROP TABLE`). Run `supabase backups restore --project-ref <ref> --backup-id <id>`. After restore completes, the dropped table must exist again with its original rows.

**Acceptance Scenarios**:

1. **Given** the project has three completed backups, **When** `supabase backups list --project-ref <ref>` runs, **Then** the response includes all three, each with `id`, `inserted_at`, `status`, `kind` (`physical_backup`), and `size_bytes`, ordered by `inserted_at` descending.
2. **Given** the project has no backups, **When** `supabase backups list` runs, **Then** the response is an empty array (not 404).
3. **Given** a valid backup id, **When** `supabase backups restore --project-ref <ref> --backup-id <id>` runs, **Then** the API returns 202 Accepted with a `restore_job_id`, the project status transitions to `restoring`, and an async restore job is enqueued.
4. **Given** an in-progress restore, **When** the CLI polls `GET /v1/projects/<ref>/database/backups/restore-status` (or similar), **Then** the response includes the job's progress (`pending`, `running`, `success`, `failed`) and `started_at` / `completed_at` timestamps when applicable.
5. **Given** a successful restore, **When** queried after completion, **Then** the project status is back to `running` and the database state matches the snapshot taken at backup time.
6. **Given** a failed restore (e.g., backup file corrupted), **When** the job exits, **Then** the project rolls back to its pre-restore state (no half-restored data) and the job status is `failed` with an `error_message`.
7. **Given** an unauthenticated request, **When** restore is called, **Then** the response is 401.
8. **Given** an authenticated non-admin user, **When** restore is called, **Then** the response is 403 (restore is admin-only by RBAC).

---

### Edge Cases

#### Gen types

- **No user tables**: emit a valid `Database` type (empty `public.Tables`) rather than a syntax-broken file.
- **Schema not present**: requesting `--schema fakeschema` returns 400 with `{ schema: "not found" }`.
- **Paused project**: returns 409 with `project_not_running`.
- **Exotic PG types** (tsvector, custom composites, range, geometric): map to `unknown` or `string` without crashing.
- **Generated / identity columns**: marked not-required in Insert and not-allowed in Update.
- **Views / materialized views**: included in `Database.<schema>.Views` with only the Row variant.
- **RPC functions**: included in `Database.<schema>.Functions` with typed Args/Returns.
- **Very large schemas (1000+ tables)**: completes in under 30 seconds without OOM.

#### Migrations

- **`migration list` on a project with no migrations**: empty array, no 404, no 500.
- **Malformed version format**: 400 with `invalid_version_format`.
- **Re-upserting an existing version**: idempotent — 200 with no duplicate.
- **Deleting a non-existent version**: idempotent — 200, no error.
- **`migration up` failure**: failed migration NOT recorded as applied; CLI surfaces SQL error verbatim.
- **`migration fetch` with 500+ migrations**: completes in under 30s.
- **Concurrent `migration up` from two CLI sessions**: no double-application (relies on standard advisory-lock pattern in the CLI).
- **Missing `supabase_migrations` schema**: lazily created on first call.

#### Snippets

- **User has access to zero projects**: `snippets list` returns empty array.
- **User has access to a project but the `user_content` schema doesn't exist** (older Studio versions): treat as zero snippets for that project, not 500.
- **Snippet id refers to a deleted snippet**: 404.
- **Snippet with very large body** (>1MB): served fully without truncation.
- **Snippet owned by user A, accessed by user B with the same project access** (Studio supports shared snippets via a `visibility` column): both list and download succeed for B if visibility is `project` or `org`, blocked if `user`.

#### Backups

- **Backup id from a different project**: 404 (don't leak cross-project existence).
- **Restore while a restore is already in-flight**: 409 with `restore_in_progress`.
- **Restore while project is paused**: 409 with `project_paused` — operator must resume first.
- **Restore that fails mid-run**: rollback runs automatically (swap the pre-restore data dir back in, restart all sibling services). Job is marked `failed` with `error_message`; project returns to `running` if the rollback restart succeeds, else `failed`.
- **Backup file deleted from underlying storage** (operator pruned it manually): list shows it with status `MISSING`; restore on it returns 410 Gone.
- **Backup created on a different Postgres major version**: restore returns 400 with `incompatible_pg_version` before touching the data dir.
- **Insufficient disk space for the pre-restore snapshot**: pre-flight check (estimated `2 × existing data_dir size`) rejects the POST with `409 disk_space_insufficient` and tells the user how much more is needed. No state is mutated.
- **Restore exceeds its time budget** (dynamic per Clarifications: `5 min base + 1 min/GB of blob + 5 min healthcheck`): job marked `failed` with `timeout_exceeded`; rollback runs as usual.
- **Sibling services (auth, rest, storage, realtime, edge functions) during restore**: stopped before the data-dir swap, restarted after Postgres is healthy. Clients see consistent unreachability during the restore window rather than per-service partial errors.
- **Restore with concurrent client connections**: existing connections are terminated as part of stopping the instance; the CLI documents this in its confirmation prompt.

## Requirements *(mandatory)*

### Functional Requirements

#### Gen types

- **FR-001**: System MUST expose `GET /v1/projects/<ref>/types/typescript` returning `{ types: <string> }` byte-compatible with Supabase Cloud's same endpoint for the same schema shape.
- **FR-002**: MUST accept optional repeatable `schemas` query parameter; default to `public` only.
- **FR-003**: Generated types MUST match Cloud's `pg-meta`-driven generator: same field ordering, type mappings, Row/Insert/Update split.
- **FR-004**: Emitted file MUST validate as a `Database` generic for `@supabase/supabase-js`, passing `tsc --noEmit`.

#### Migrations

- **FR-005**: MUST expose `GET /v1/projects/<ref>/database/migrations` returning `[{ version, name, statements }]` ordered by `version` ascending. Matches upstream Cloud shape.
- **FR-006**: MUST expose `POST /v1/projects/<ref>/database/migrations/upsert` accepting `{ version, name?, statements? }`. Idempotent on re-upsert.
- **FR-007**: MUST expose `DELETE /v1/projects/<ref>/database/migrations/<version>`. Idempotent on missing version.
- **FR-008**: MUST validate `version` against `^\d{14}$` and reject malformed input with 400 + `invalid_version_format`.
- **FR-009**: MUST lazily create `supabase_migrations.schema_migrations` on first call if absent.
- **FR-010**: Write operations (upsert, delete) MUST emit an audit log entry.

#### Snippets

- **FR-011**: MUST expose `GET /v1/snippets` returning an array of snippet summaries — `{ id, name, description, project_ref, owner_id, inserted_at, updated_at, visibility }` — across all projects the PAT owner can access. Supports optional `?project_ref=<ref>` to scope to one project.
- **FR-012**: MUST expose `GET /v1/snippets/<id>` returning the full snippet including `content` (SQL body). Returns 404 if id doesn't exist OR is not accessible to the caller.
- **FR-013**: Snippet visibility rules MUST mirror Studio's: `user` visible only to the owner; `project` visible to anyone with access to that project; `org` visible to anyone in that org with access to at least one project.
- **FR-014**: Both snippet endpoints MUST be read-only. Create / update / delete of snippets remains a Studio-only operation in this feature; not exposed via Management API.
- **FR-015**: MUST tolerate per-project Postgres instances that lack the `user_content` schema by treating that project as having zero snippets, not erroring.

#### Backups

- **FR-016**: MUST expose `GET /v1/projects/<ref>/database/backups` returning `{ backups: [{ id, inserted_at, status, kind, size_bytes }], physical_backup_data: { earliest_physical_backup_date_at, latest_physical_backup_date_at } }`. Matches upstream Cloud shape (Cloud uses PITR for the dates; selfbase uses snapshot timestamps).
- **FR-017**: MUST expose `POST /v1/projects/<ref>/database/backups/restore-pitr` accepting `{ backup_id: <id> }` (selfbase uses snapshot id rather than recovery_time_target). Returns 202 with `{ restore_job_id }`.
- **FR-018**: MUST expose `GET /v1/projects/<ref>/database/backups/restore-status` returning the current/most-recent restore job: `{ id, status, started_at?, completed_at?, error_message? }`. Status values: `pending`, `running`, `success`, `failed`.
- **FR-019**: Restore MUST be an async job — the API returns 202 immediately and the actual restore (stop ALL sibling services → swap data dir → restart ALL services → verify) runs in the background.
- **FR-020**: During restore, the project's status MUST be `restoring` (new value); the dashboard MUST show this state and disable destructive ops on the project.
- **FR-021**: If restore fails partway through, the worker MUST roll the project back to its pre-restore state (preserved data dir snapshot) and restart all sibling services such that the final project state is consistent.
- **FR-022**: Restore MUST be RBAC-gated to organisation owners + admins; member-level roles get 403.
- **FR-023**: Restore initiation MUST emit a high-severity audit log entry capturing actor, project ref, backup id, and timestamp.
- **FR-024**: System MUST pre-flight disk space before accepting the restore. If `df` on the instance's data volume reports less than `2 × existing data_dir size` free, the POST is rejected with `409 disk_space_insufficient` and a body including `required_bytes` + `available_bytes`. No `restore_jobs` row is created; no instance state is touched.
- **FR-025**: The restore worker MUST stop the entire per-instance compose stack (db + auth + rest + storage + realtime + meta + functions + analytics + vector + imgproxy + studio + kong) before the data-dir swap and restart it after Postgres returns to healthy. Sibling services do not run against an inconsistent / mid-restore Postgres.
- **FR-026**: The restore worker MUST enforce a dynamic timeout per job, computed as `5 minutes (base) + 1 minute per GB of backup blob size + 5 minutes (final healthcheck window)`. On budget exhaustion the worker MUST mark the job `failed` with `error_message = 'timeout_exceeded (budget: <N> minutes)'` and run the standard rollback.
- **FR-027**: The pre-restore data-dir snapshot (`data.pre-restore-<job_id>`) MUST be retained for 24 hours after a successful restore, then garbage-collected by a scheduled job. The path MUST be cleared from `restore_jobs.pre_restore_dir` after GC. For failed restores, the pre-restore dir is consumed by the rollback and removed in the same job.

#### Cross-cutting

- **FR-028**: All endpoints MUST require a valid PAT (existing mechanism from feature 003), and MUST reject requests for refs the PAT's owner cannot access with 403.
- **FR-029**: All endpoints MUST return 404 for unknown refs and 409 for refs not in a usable state, with the standard error envelope.
- **FR-030**: All endpoints MUST use the existing structured error envelope (`{ error: { code, message, details? } }`) and HTTP status conventions across `/v1/*`.
- **FR-031**: All endpoints outside this feature's scope continue to return `501 not_implemented`.

### Key Entities

- **Schema migration row**: existing record in per-project Postgres at `supabase_migrations.schema_migrations` with `version` (14-digit timestamp, PK), `name` (nullable), `statements` (nullable text array). Exposed via API only — no new storage.
- **Snippet**: existing record in per-project Postgres at `user_content.content` (Studio's schema) with at minimum `id` (UUID, PK), `name`, `description`, `content` (SQL body), `owner_id`, `visibility` (`user|project|org`), `inserted_at`, `updated_at`. Exposed via API only — no new storage.
- **Backup**: existing record in the control-plane `backups` table — id, instance_ref FK, kind, status, size_bytes, store_key, inserted_at, completed_at. Already populated by the existing backup job. This feature adds the read side via Management API + the restore-job side.
- **Restore job**: NEW entity in control-plane DB. Fields: `id`, `instance_ref` FK, `backup_id` FK, `status` (`pending|running|success|failed`), `started_at`, `completed_at`, `error_message`, `created_at`. One in-flight restore per instance (enforced by partial unique index on `(instance_ref) WHERE status IN ('pending','running')`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `supabase gen types typescript --project-id <ref>` completes in under 10 seconds for ≤100 tables (30s for ≤1000 tables); output passes `tsc --noEmit` against `@supabase/supabase-js`.
- **SC-002**: For 100% of selected schemas/tables in a test fixture project, emitted types match the actual DB shape verified against `information_schema`.
- **SC-003**: Round-trip migration test passes: `migration new` → edit → `migration up` → `migration list` → manual delete → `migration repair --status applied` → `migration list` → `migration fetch` — each command exits 0 and final state matches initial.
- **SC-004**: `supabase migration list` against a project with ≤500 applied migrations returns within 5 seconds; `supabase migration fetch` within 30 seconds.
- **SC-005**: Two concurrent `supabase migration up` invocations against the same project from different CLI sessions do not result in the same migration being applied twice.
- **SC-006**: `supabase snippets list` against a project with ≤200 snippets returns within 2 seconds. `supabase snippets download <id>` returns the full SQL body for snippets up to 5MB in under 3 seconds.
- **SC-007**: Backup-restore round-trip works: drop a table → `supabase backups restore --backup-id <id>` → after restore completes (within the dynamic budget `5min + 1min/GB + 5min` — e.g., ≤11 min for a 1GB backup, ≤25min for a 15GB backup), the dropped table exists with its original rows and all sibling services (auth, rest, storage, realtime, edge functions) are reachable again.
- **SC-008**: A failed restore mid-run leaves the project fully rolled back to the pre-restore state and restarts all sibling services — never in a partially-restored zombie state. Verified by killing the worker mid-restore and checking final state (data dir matches pre-restore, sibling services running, restore_jobs row marked `failed` with `error_message`).
- **SC-011**: Restore against an instance with insufficient free disk (less than `2 × data_dir` available) is rejected pre-flight with `409 disk_space_insufficient` in under 500ms; the instance state is unchanged after the call.
- **SC-012**: Pre-restore snapshot directory is automatically removed 24 hours after a successful restore (verified by an integration test that fast-forwards the GC clock).
- **SC-009**: All four CLI surfaces (gen types, migration *, snippets list/download, backups list/restore) are operable end-to-end against a fresh selfbase install with zero `not_implemented` errors for the in-scope subcommands.
- **SC-010**: Existing P0 CLI commands (`login`, `link`, `functions *`, `secrets *`) plus feature-005 commands (`db push/pull/diff`) continue to pass their existing integration tests with zero regressions.

## Assumptions

- The upstream Supabase CLI's request/response shapes (per https://api.supabase.com/api/v1-json) are the source of truth — selfbase matches them so the CLI does not need a selfbase-specific build. We target the current stable CLI release at feature start.
- For gen types: the `pg-meta` container that ships with every Supabase stack already provides a typed introspection surface — implementation may reuse it or query `information_schema` directly.
- For migrations: the api reaches per-instance Postgres via the same channel feature 005 uses (direct or pooler). No new network path.
- For snippets: Studio stores snippets in `user_content.content` on the per-project Postgres. The API reads from there. Selfbase does NOT introduce a separate snippet store. If a project's Postgres lacks the schema (pre-Studio or schema-purged), the project contributes zero snippets.
- For backups: the existing backup job + `backups` table is reused for the read side. Restore is NEW — implementation needs a worker job that stops the instance, swaps the data dir, restarts. Restore semantics are snapshot-based, not PITR — Cloud uses PITR via WAL streaming; selfbase doesn't currently capture WAL, so we expose the snapshot-id model under the same endpoint name. The CLI accepts both.
- Restore is destructive and admin-only by RBAC. The CLI's confirmation prompt is the primary user-side guardrail; the API's audit log + high-severity event is the secondary.
- The `restore_job` entity is a new control-plane table; it tracks the lifecycle of one restore operation. One in-flight restore per project at a time.
- Existing PAT auth, RBAC ownership checks, and the rate-limit envelope from feature 003 are reused unchanged across all endpoints.
- Arbitrary-SQL `POST /v1/projects/<ref>/database/query` remains OUT of scope — security-sensitive, own spec.
- TypeScript type-emission mapping (gen types): numeric → `number`, text/varchar/uuid → `string`, bool → `boolean`, jsonb → `Json`, arrays → `T[]`, enums → string-literal unions, custom/composite → `unknown`.
- Dashboard UI surfaces for migration history / snippet browser / backup restore button are out of scope. CLI compatibility is the primary deliverable; dashboard surfacing can follow.
