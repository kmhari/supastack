# Phase 0: Research & Design Decisions

**Feature**: 006-mgmt-gen-types (CLI Tier 1 — gen types + migration + snippets + backups)

---

## Decision 1: TypeScript code generation strategy for `gen types`

**Decision**: Call the per-instance `pg-meta` container's `/types/typescript` endpoint (or equivalent introspection routes), then forward its TypeScript output through the api with minimal post-processing. Fall back to direct `information_schema` introspection only if the per-instance `pg-meta` is missing or unreachable.

**Rationale**:
- The Supabase Cloud generator uses `pg-meta` under the hood — reusing it gives us byte-compat for free.
- Every supastack project already ships `pg-meta` in its compose template (it powers Studio's table editor).
- Re-implementing `information_schema` traversal + TS emission from scratch would be ~1000 LOC of fragile code that has to track upstream pg-meta changes manually.

**Alternatives considered**:
- **Direct `information_schema` + handwritten TS emitter**: more control, but high maintenance burden + risk of subtle drift from Cloud output.
- **Spawn `supabase` CLI on the api side and capture its output**: would couple our api to a fork of the CLI; ugly.

**Implementation note**: `pg-meta` is on the internal docker network (`supastack-<ref>-meta-1`). The api reaches it via `host.docker.internal:<port_meta>` (similar to how the pg-edge-proxy reaches per-instance Postgres). Port mapping needs to be exposed in the supabase_instances row — add `port_meta` column if not already present.

---

## Decision 2: Migration endpoint connection model

**Decision**: All three migration endpoints (list / upsert / delete) connect directly to the per-instance Postgres via the shared `per-instance-pg.ts` helper, using `host.docker.internal:<port_db_direct>` with the postgres role's decrypted password. They do NOT route through supavisor.

**Rationale**:
- Supavisor adds nothing for these endpoints (tiny queries, no pool benefit at this scale).
- Direct connection means the api isn't blocked by a supavisor outage for the migration surface.
- The connection helper already exists in pattern (we built parts of it for `apps/api/scripts/backfill-pooler-tenants.ts`).

**Alternatives considered**:
- **Via supavisor**: extra hop, extra failure mode, no upside for read+upsert.
- **Via management/CLI shelling out to `supabase migration` itself**: same anti-pattern as Decision 1.

---

## Decision 3: Lazy bootstrap of `supabase_migrations.schema_migrations`

**Decision**: On every migration-API call, the api ensures the schema + table exist via `CREATE SCHEMA IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS` issued at connection time (inside a SAVEPOINT-wrapped block so it's idempotent and harmless when already present).

**Rationale**:
- FR-009 requires the schema to exist lazily.
- Doing it on every call is cheap (server-side notice for "already exists" is essentially free in PG).
- Avoids a separate "bootstrap migrations schema" provision step that would need to backfill old instances.

**Alternatives considered**:
- **One-time bootstrap during instance provision**: doesn't help pre-006 instances; also adds another provisioning step that can fail.
- **On-demand bootstrap with a cached "already done" flag in control plane**: extra state to keep in sync, no perf benefit.

---

## Decision 4: Snippet storage and visibility model

**Decision**: Snippets live in the per-instance Postgres at `user_content.content` (Studio's existing storage). The Management API endpoints read directly from there. Visibility filtering (`user|project|org`) happens in the api layer, NOT via per-instance Postgres RLS.

**Rationale**:
- Studio already stores snippets in `user_content.content` — using that surface keeps the two views consistent (Studio + CLI see the same snippets immediately).
- Studio's `user_content` schema is unmodified upstream and has no RLS — we'd diverge from upstream if we added it, which would break Studio's own queries.
- API-layer filtering is straightforward: the api knows the caller's user_id (from PAT) + project access (from existing RBAC); it filters the rows from `user_content.content` accordingly.

**Cross-project enumeration** (`GET /v1/snippets` without `?project_ref=`):
- The api iterates the projects the caller has access to.
- For each, connects to the per-instance PG and reads matching `user_content.content` rows.
- Aggregates and sorts client-side.
- N+1 connection cost — acceptable at SC-006's 200-snippet ceiling, but cap at 50 projects per request and document the limit.

**Alternatives considered**:
- **Centralized snippet store in control plane**: would diverge from Studio, force a sync layer.
- **Per-project Postgres RLS for visibility**: would diverge from upstream Supabase template; high migration cost.

---

## Decision 5: Restore architecture — snapshot-id, not WAL/PITR

**Decision**: Supastack's restore takes a `backup_id` referring to an existing physical snapshot (from the `backups` table), stops the per-instance Postgres, swaps its data directory with a fresh extraction of the snapshot, and restarts. The endpoint is named `/restore-pitr` for CLI compatibility but the payload differs.

**Rationale**:
- Cloud uses continuous WAL streaming for PITR; supastack doesn't currently capture WAL.
- Snapshot restore matches the granularity we actually have (whatever the backup job took, nightly typically).
- Naming the endpoint `/restore-pitr` lets the CLI's `supabase backups restore` work unchanged; the CLI sends `recovery_time_target` — we accept it but ignore it in favor of `backup_id` (and document the deviation in the contract).

**Alternatives considered**:
- **Implement WAL archiving + true PITR**: substantial new infrastructure (continuous archive, replay, point-in-time targeting). Out of scope; track as a separate future feature.
- **Use a different endpoint name to be honest about semantics**: would break CLI compatibility — the CLI hardcodes `/restore-pitr`. Forking the CLI is not on the table.

---

## Decision 6: Restore rollback strategy

**Decision**: Before swapping the data dir, the worker takes a filesystem-level snapshot of the existing data dir to a sibling directory (`/var/supastack/instances/<ref>/volumes/db/data.pre-restore-<job-id>`). If anything in the restore pipeline fails, the worker swaps the original dir back and marks the job `failed`. The pre-restore dir is kept for 24h then garbage-collected.

**Rationale**:
- FR-021 requires clean rollback. Filesystem-level snapshot is the only reliable way to guarantee bit-exact rollback.
- Doing it in-process (rather than relying on LVM/zfs/btrfs snapshots) keeps the implementation portable across operator environments.
- 24h retention gives the operator a recovery window if the restore "succeeded" but actually broke something subtle.

**Alternatives considered**:
- **`pg_basebackup` + WAL replay for in-place restore**: complex, requires the running server, defeats the "swap data dir" simplicity.
- **No rollback, trust the restore**: violates FR-021. Failed restores would leave the project in zombie state.

**Disk-space impact**: Doubles instance disk usage during restore + 24h after. Documented in the contract.

---

## Decision 7: Restore concurrency control

**Decision**: A partial unique index on `restore_jobs(instance_ref) WHERE status IN ('pending','running')` enforces at most one in-flight restore per project. Second concurrent restore attempts return 409 `restore_in_progress`.

**Rationale**:
- DB-level constraint = single source of truth. No race in the api layer.
- The CLI's existing pattern for concurrent operations against the same resource is to return 409 and let the user retry; matches that.

**Alternatives considered**:
- **Redis-based lock**: extra dep, race on lock acquisition.
- **BullMQ exclusive job**: BullMQ doesn't natively enforce one-job-per-resource without custom logic.

---

## Decision 8: Per-instance PG connection helper — pooled vs ephemeral

**Decision**: Use ephemeral `pg.Client` instances (one per API request) rather than a long-lived pool. Connect on request, close on response.

**Rationale**:
- Per-request connection cost is ~5-15ms over the docker network — negligible vs. the actual query times for these endpoints.
- A pool would require keeping the secret-decryption + connection metadata for every project in memory; doesn't scale to many projects.
- Ephemeral simplifies error handling (no stale-connection edge cases) and authz revalidation (each request re-decrypts secrets, so a rotated password is picked up immediately).

**Alternatives considered**:
- **Long-lived pool per project**: caching invalidation pain, scaling concerns.
- **Route all per-instance PG ops through supavisor**: extra hop with no benefit for the low query volume here.

---

## Decision 9: Audit log surface

**Decision**: All write endpoints (`migration upsert`, `migration delete`, `restore-pitr`) emit one audit-log row with the standard envelope (`actor_id`, `project_ref`, `event_type`, `payload`). Read endpoints (gen-types, migration list, snippets list/download, backups list, restore-status) do NOT emit audit entries.

**Rationale**:
- FR-010, FR-023 require write-side audit.
- Read events at this volume (gen-types runs on every TS build) would flood the audit log with no security value.
- Restore is high-severity — same audit shape but with `severity='high'` so it filters into the dashboard's important-events feed.

**New `event_type` values**:
- `mgmt_api.migration.upsert`
- `mgmt_api.migration.delete`
- `mgmt_api.backup.restore_started` (severity high)
- `mgmt_api.backup.restore_completed` (severity high)
- `mgmt_api.backup.restore_failed` (severity high)

---

## Decision 10: RBAC matrix for new endpoints

| Endpoint | Owner | Admin | Developer | Reader |
|---|---|---|---|---|
| `GET /types/typescript` | ✓ | ✓ | ✓ | ✓ |
| `GET /database/migrations` | ✓ | ✓ | ✓ | ✓ |
| `POST /database/migrations/upsert` | ✓ | ✓ | ✓ | ✗ |
| `DELETE /database/migrations/<v>` | ✓ | ✓ | ✓ | ✗ |
| `GET /snippets`, `GET /snippets/<id>` | ✓ | ✓ | ✓ | ✓ (subject to snippet visibility) |
| `GET /database/backups` | ✓ | ✓ | ✓ | ✓ |
| `POST /database/backups/restore-pitr` | ✓ | ✓ | ✗ | ✗ |
| `GET /database/backups/restore-status` | ✓ | ✓ | ✓ | ✓ |

**Rationale**: Mirrors the principle of "destructive ops to admins only" used elsewhere. Restore is the only operation that can erase data — gated tight.

---

## Decision 11: CLI version target & compatibility envelope

**Decision**: Target Supabase CLI v1.215.0+ (current stable at feature start). Run the upstream CLI's request/response contracts as recorded snapshots in `tests/cli-e2e/`. When upstream changes shapes, update the recorded fixtures + bump the target version with a follow-up note.

**Rationale**:
- A moving target is more dangerous than a pinned one — pin first, follow up on bumps.
- CLI E2E tests with recorded fixtures catch shape changes immediately on CI runs.

**Alternatives considered**:
- **Match HEAD of the CLI**: would force perpetual chase of upstream PRs.
- **Vendor a CLI fork**: defeats the value of being CLI-compatible at all.
