# Research: Platform Stub Conversions (Tier 1–4)

## Decision 1 — pause/status Response Shape

**Decision**: Use `{ initiated_at: inst.updatedAt.toISOString() | null, status: 'not_pausing' | 'pausing' }`.

**Rationale**: Cloud's contract uses `status: 'not_pausing'` for completed/inactive pause and `'pausing'` for an in-progress pause. Supastack's status enum has no explicit `pausing` state — pause is initiated by setting status to `paused` directly via the lifecycle queue. So the mapping is:
- `status === 'paused'` → `{ initiated_at: updatedAt.toISOString(), status: 'not_pausing' }` (pause complete)
- `status === 'pausing'` (future) or any other → `{ initiated_at: null, status: 'not_pausing' }` (not pausing)

`updatedAt` is the best available timestamp for when the status last changed (there is no dedicated `paused_at` column in `supabase_instances`).

**Alternatives considered**: Adding a `paused_at` column — rejected (requires migration, violates "no migrations needed" constraint for this feature).

---

## Decision 2 — readonly Delegation Pattern

**Decision**: `DELETE /platform/projects/:ref/readonly` delegates to `POST /v1/projects/:ref/restore` via `app.inject` with only the `authorization` header forwarded (no body needed).

**Rationale**: The resume workflow (lifecycle queue job, audit log write) is already implemented in `apps/api/src/routes/management/pause-restore.ts`. Delegating reuses that code and ensures the audit log and worker queue are correctly updated without duplication.

**Alternatives considered**: Directly enqueuing the resume job in the platform handler — rejected (duplicates lifecycle logic, violates "worker owns per-instance state" consistency, misses audit log write).

---

## Decision 3 — Audit Log Query for /audit and /activity

**Decision**: Filter `audit_log` by `targetId = ref` (project ref). The `/audit` response uses `{ result: [...], count: N }` with pagination (50 rows default, `?rows=&page=` query params). The `/activity` response is a raw array of the same events ordered ascending.

**Rationale**: The org-level audit at line 1568 in `platform-misc.ts` already demonstrates the exact query pattern. Project events are written with `targetKind: 'instance'`, `targetId: ref` in `pause-restore.ts`. The same audit_log table works for both org and project scope.

**Shape difference**: Studio's `/activity` endpoint expects a simpler array without pagination metadata (confirmed from Studio `data/activity/queries.ts` usage pattern).

**Alternatives considered**: Separate audit table per project — rejected (audit_log already covers this with `targetId`).

---

## Decision 4 — Tier 3b Delegation (network-bans, network-restrictions, ssl-enforcement, functions/secrets)

**Decision**: Use `app.inject` delegation pattern (same as auth-config at line 727). Forward `fwdHeaders(req)` for GET/DELETE, forward `fwdHeaders(req)` + `JSON.stringify(req.body)` for PUT/POST.

**Rationale**:
- **ssl-enforcement**: `/v1` handler (`ssl-enforcement.ts`) is a real implementation reading `pg_hba.conf`. Delegation gives the platform endpoint the real value with no logic duplication.
- **functions/secrets**: `/v1` handler (`secrets.ts`) uses vault-backed `listSecrets`/`setSecrets`. Delegation reuses existing auth + vault logic.
- **network-bans/restrictions**: `/v1` handlers are stubs in `server.ts` (lines 249–263) returning empty data. Delegation is still correct — it ensures a single code path and automatic upgrade when /v1 gets real implementations.

**Alternatives considered**: Copy-pasting the ssl-enforcement store and secrets store logic — rejected (duplication, increases maintenance surface).

---

## Decision 5 — Downloadable Backups Shape

**Decision**: Return `{ backups: [...] }` where each entry is `{ id: Number(seq), inserted_at: startedAt.toISOString(), completed_at: completedAt?.toISOString() ?? null, size_bytes: Number(sizeBytes ?? 0), isPhysicalBackup: true, status: 'COMPLETED' }`.

**Rationale**: Same data source as `restore/versions` (backups table, `status='completed'`). Studio's download panel expects a `backups` wrapper key and slightly different field names than the restore endpoint. `isPhysicalBackup: true` is consistent — supastack only does physical backups.

**Alternatives considered**: Reusing `listBackupsForPlatform` — that function returns the restore shape. A new thin mapping is cleaner.

---

## Decision 6 — Lint Queries (Tier 4)

**Decision**: Implement 5 advisory lint checks using read-only queries against `pg_stat_*` and system catalogs via `withPerInstancePg`.

| Check name | Query target | Level |
|-----------|-------------|-------|
| `no_rls` | `pg_tables` joined with `pg_class` where `rowsecurity = false` (public schema user tables) | WARN |
| `duplicate_index` | `pg_indexes` grouped by table+column expression, count > 1 | WARN |
| `unused_index` | `pg_stat_user_indexes` where `idx_scan = 0` AND table has > 0 rows | INFO |
| `bloat` | `pg_stat_user_tables` where `n_dead_tup > n_live_tup * 0.1` (>10% dead tuples) | INFO |
| `sequence_wraparound` | `pg_sequences` where `last_value / max_value > 0.8` | WARN |

Return shape per result: `{ name: string, title: string, level: 'INFO'|'WARN'|'ERROR', description: string, metadata: Record<string, unknown> }`.

Timeout: `withPerInstancePg` has no inherent timeout; the per-instance Postgres `statement_timeout` applies. For Tier 4, queries run with `read_only: true` semantics (SET transaction read only is not needed — queries are all SELECT).

**Project not running**: If `withPerInstancePg` throws `InstanceNotRunningError`, catch and return 503 with `{ error: 'Project is not running', code: 'project_not_running' }`.

**Alternatives considered**: Using the existing `POST /v1/projects/:ref/database/query` delegation for lint — rejected (that route runs user-provided SQL; lint queries are fixed and should bypass the management API overhead).

---

## Decision 7 — org membership check for platform endpoints

**Decision**: Use the existing `innerJoin(organizationMembers, ...)` pattern (same as `databases-statuses` at line 1083) to verify the authenticated user belongs to the project's org before returning data. Return 404 if not found (consistent with all other platform project endpoints — 404 on unknown or unauthorized ref).

**Rationale**: Platform endpoints don't use the RBAC matrix (Principle III) — they use org membership as their authorization check. This is established convention for all platform project endpoints.
