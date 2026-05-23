# Contract: `/v1/projects/<ref>/database/backups[/...]`

Powers `supabase backups list` and `supabase backups restore`.

## Endpoints

```
GET  /v1/projects/<ref>/database/backups
POST /v1/projects/<ref>/database/backups/restore-pitr
GET  /v1/projects/<ref>/database/backups/restore-status
```

All require `Authorization: Bearer <PAT>`. Restore is admin-only (Decision 10).

---

## `GET /database/backups`

### Response 200
```json
{
  "backups": [
    {
      "id": "550e8400-...",
      "inserted_at": "2026-05-23T03:00:00Z",
      "status": "COMPLETED",
      "kind": "physical_backup",
      "size_bytes": 1048576123
    }
  ],
  "physical_backup_data": {
    "earliest_physical_backup_date_at": "2026-05-16T03:00:00Z",
    "latest_physical_backup_date_at": "2026-05-23T03:00:00Z"
  },
  "region": "local",
  "pitr_enabled": false,
  "walg_enabled": false
}
```
- `backups[]` is sorted by `inserted_at` descending.
- `physical_backup_data` is derived (min/max of `inserted_at` for COMPLETED rows). `null` keys when no backups.
- `pitr_enabled`, `walg_enabled` are always `false` (selfbase doesn't have WAL streaming) — included for CLI shape compat.
- `status` values: `COMPLETED`, `MISSING` (blob deleted from underlying storage), `FAILED`.

### Behavior
1. Resolve project. 404 / 409 as standard.
2. `SELECT id, inserted_at, status, kind, size_bytes FROM backups WHERE instance_ref = $1 AND status != 'pending' ORDER BY inserted_at DESC`.
3. Compute derived fields and wrap.

---

## `POST /database/backups/restore-pitr`

### Request
```json
{ "backup_id": "550e8400-..." }
```

The CLI sends `{ "recovery_time_target": "2026-05-23T03:00:00Z" }` — the api accepts both:
- If `backup_id` present: use that backup id directly.
- Else if `recovery_time_target` present: find the most recent `COMPLETED` backup whose `inserted_at <= recovery_time_target` and use its id.
- Else 400 `missing_target`.

### Response 202 Accepted
```json
{
  "restore_job_id": "<uuid>",
  "status": "pending",
  "backup_id": "<uuid>"
}
```

### Response 409 Conflict
- `restore_in_progress`: another restore is `pending` or `running` for this project.
- `project_paused`: project is paused; must resume before restoring.
- `backup_status_invalid`: backup is `MISSING` or `FAILED`.
- `disk_space_insufficient`: pre-flight disk check failed. Body includes `{ details: { required_bytes, available_bytes, data_dir_bytes } }`. Required = `2 × data_dir_bytes`. No state mutated.

### Response 400
- `invalid_target`: neither `backup_id` nor `recovery_time_target` present, or both invalid.
- `incompatible_pg_version`: backup's PG major version differs from running instance's. Detected pre-flight.

### Response 410 Gone
- `backup_blob_missing`: blob no longer in underlying storage.

### Response 403
- Non-admin caller.

### Behavior
1. RBAC check: caller must be owner or admin of the project's org. 403 otherwise.
2. Validate input → resolve `backup_id`.
3. Verify backup exists, status = `COMPLETED`, blob present in store.
4. Pre-flight PG version: compare backup's PG major version vs running instance's. 400 on mismatch.
5. **Pre-flight disk space**: stat the instance's data dir size, stat `df` on the volume. If `available_bytes < 2 × data_dir_bytes`, return 409 `disk_space_insufficient` (no state changes).
6. Compute dynamic timeout budget: `300 + ceil(backup_size_bytes / 1e9) * 60 + 300` seconds (5 min base + 1 min/GB + 5 min healthcheck).
7. Begin TX:
   - INSERT `restore_jobs` with `timeout_budget_seconds` stored on the row (the partial unique index gates concurrency → 409 on conflict).
   - UPDATE `supabase_instances.status = 'restoring'`.
8. Commit TX, enqueue BullMQ `restore` job with `{ restore_job_id }`.
9. Return 202.
10. Emit audit log `mgmt_api.backup.restore_started` (severity high).

---

## `GET /database/backups/restore-status`

### Response 200
```json
{
  "current": {
    "id": "<uuid>",
    "backup_id": "<uuid>",
    "status": "running",
    "started_at": "2026-05-23T16:00:00Z",
    "completed_at": null,
    "error_message": null
  },
  "history": [
    { "id": "...", "status": "success", "started_at": "...", "completed_at": "...", "error_message": null }
  ]
}
```
- `current` is the most recent non-terminal job, or the most recent terminal one if none in flight.
- `history` is the last 10 terminal jobs.

### Behavior
1. Resolve project. 404 as standard.
2. `SELECT ... FROM restore_jobs WHERE instance_ref = $1 ORDER BY created_at DESC LIMIT 11` then split.

---

## Worker job: `restore` (apps/worker/src/jobs/restore.ts)

**Trigger**: BullMQ message `{ restore_job_id }` from the restore-pitr POST.

**Steps** (whole worker wrapped in a watchdog that aborts at `timeout_budget_seconds`):
1. Load job from DB. If status != `pending`, exit (idempotency guard for retries).
2. UPDATE `restore_jobs.status = 'running', started_at = now()`.
3. Fetch the backup blob to `/tmp/restore-<job_id>.tar.gz`. Verify SHA-256 if recorded; else continue.
4. `docker compose stop` for the WHOLE per-instance stack (db + auth + rest + storage + realtime + meta + functions + analytics + vector + imgproxy + studio + kong). FR-025 — sibling services must not run against an inconsistent / mid-restore Postgres.
5. Take pre-restore snapshot: `mv /var/selfbase/instances/<ref>/volumes/db/data /var/selfbase/instances/<ref>/volumes/db/data.pre-restore-<job_id>`. Record path in `restore_jobs.pre_restore_dir`.
6. Extract blob into the now-empty `db/data` location.
7. `docker compose start` for the WHOLE per-instance stack.
8. Wait for db healthcheck (5 min window, part of overall budget).
9. Smoke probe: `SELECT 1 FROM pg_catalog.pg_tables LIMIT 1` succeeds.
10. Wait for sibling-service healthchecks to recover (auth, rest, kong reachable).
11. UPDATE `restore_jobs.status = 'success', completed_at = now()`.
12. UPDATE `supabase_instances.status = 'running'`.
13. Schedule a delayed BullMQ message to the `restore-gc` worker for 24h later, payload `{ restore_job_id }`.
14. Emit audit log `mgmt_api.backup.restore_completed`.

**On any error (including watchdog timeout)**:
1. Best-effort `docker compose stop` for the whole stack.
2. If pre-restore snapshot exists: `rm -rf db/data && mv db/data.pre-restore-<job_id> db/data`.
3. `docker compose start` for the whole stack.
4. Wait for db healthcheck + sibling services. If THAT fails: leave instance in `failed` status, log a high-severity event, require operator intervention.
5. UPDATE `restore_jobs.status = 'failed', completed_at = now(), error_message = <reason or 'timeout_exceeded (budget: <N>s)'>`.
6. UPDATE `supabase_instances.status = 'running'` (if rollback healthcheck recovered) else `'failed'`.
7. Emit audit log `mgmt_api.backup.restore_failed`.
8. Clear `pre_restore_dir` on the job row (rollback consumed it).

**`restore-gc` worker** (separate, fires 24h after success):
1. Load job. If `pre_restore_dir` is null, exit (already GC'd).
2. `rm -rf <pre_restore_dir>`.
3. UPDATE `restore_jobs.pre_restore_dir = null`.

---

## Cross-cutting

### Errors
Standard envelope.

### Performance
- `list`: <500ms.
- `restore-pitr` (POST): <2s (just enqueues).
- `restore-status` (GET): <500ms.
- Actual restore worker: <5 min for 1GB DB (SC-007).

### Test cases
| # | Scenario | Expected |
|---|---|---|
| 1 | List with 0 backups | 200, `backups: []`, `physical_backup_data.*` keys null |
| 2 | List with 3 backups | 200, sorted desc, derived fields correct |
| 3 | Restore valid backup | 202, job enqueued, status `pending` → `running` → `success` |
| 4 | Restore with `recovery_time_target` instead of `backup_id` | 202, picks correct backup |
| 5 | Restore while another in flight | 409, `restore_in_progress` |
| 6 | Restore for paused project | 409, `project_paused` |
| 7 | Restore non-admin caller | 403 |
| 8 | Restore backup with missing blob | 410 |
| 9 | Restore backup from PG 14 to PG 15 instance | 400, `incompatible_pg_version` |
| 10 | Worker killed mid-restore | next reconciler tick rolls back via pre_restore_dir, job marked `failed` |
| 11 | Restore success E2E: DROP TABLE → restore → table back | data identical |
| 12 | Restore-status returns current + history | shape matches contract |
