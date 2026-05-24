# Contract: `POST /api/v1/instances/:ref/reset-pg-password`

Resets the per-instance Postgres `postgres` + `supabase_admin` role passwords to match the stored `encrypted_secrets.postgresPassword`. The recovery path for both `pg_password_drift` and `pg_password_drift_at_provision`.

## Request

```
POST /api/v1/instances/<ref>/reset-pg-password
Cookie: session=<admin>
```

Admin-only. No body.

## Response 200 (sync reconciler completed within 5s)

```json
{
  "ref": "asyobqcbycmqjeribjfv",
  "message": "Password reset successfully; verified working.",
  "reset_at": "2026-05-24T15:00:00Z",
  "pooler_tenant_status": "active",
  "reconciler_run_id": "uuid"
}
```

## Response 200 (sync reconciler didn't complete in 5s)

```json
{
  "ref": "asyobqcbycmqjeribjfv",
  "message": "Password reset; reconciler queued. Poll /pooler/status for state.",
  "reset_at": "2026-05-24T15:00:00Z",
  "pooler_tenant_status": "pg_password_drift",
  "reconciler_run_id": "uuid"
}
```

## Response 403 / 404 / 409 / 502

- 403: non-admin
- 404: ref doesn't exist
- 409: instance status is `paused`, `deleting`, or `provisioning` (in-flight provision; reset isn't safe). NOT 409 if status is `failed` with `provision_error = pg_password_drift_at_provision` — that's the recovery path.
- 502: docker exec into the per-instance db container failed (container down, docker socket issue, ALTER returned a PG error). Body includes the underlying error.

## Behavior

1. RBAC: admin only. Audit log `instances.pg_password.reset` (severity high) emitted before ALTER.
2. Load instance. 404 if not found. 409 if status is `paused|deleting|provisioning`.
3. Decrypt `encrypted_secrets.postgresPassword`.
4. Run via docker exec on the per-instance db container:
   ```sql
   BEGIN;
   ALTER USER postgres WITH PASSWORD '<escaped>';
   ALTER USER supabase_admin WITH PASSWORD '<escaped>';
   COMMIT;
   ```
   - Connection via `psql -h 127.0.0.1 -U supabase_admin -d postgres -c "..."` (trust auth per Decision 6).
   - Password escaped via PG's `''` → `''''` rule.
   - On failure: 502 with body containing the PG error.
5. Enqueue a single-instance reconciler pass for this ref (high priority).
6. Wait up to 5s for the pass to complete (using polling on `reconciler_runs` or a BullMQ job-complete promise).
7. Return 200 with `pooler_tenant_status` = final state. If timeout, return with the queued state.

## Performance

- Step 4 (ALTER): p95 < 500 ms.
- Step 5-7 (sync reconciler): p95 < 3 s.
- Total: p95 < 5 s.

## Test cases

| # | Scenario | Expected |
|---|---|---|
| 1 | Drifted project, reset works | 200, `pooler_tenant_status=active`, fast |
| 2 | Drifted project, supavisor down | 200, `pooler_tenant_status=failed` (the drift is gone but supavisor issue surfaces) |
| 3 | Reset on healthy project (no-op) | 200, `pooler_tenant_status=active` |
| 4 | Reset called twice quickly | both 200; ALTER is idempotent at PG level |
| 5 | Per-instance db container down | 502 `per_instance_db_unreachable` |
| 6 | Instance paused | 409 `project_not_running` |
| 7 | Instance failed with pg_password_drift_at_provision | 200 (recovery path); operator can then "Retry provision" |
| 8 | Non-admin | 403 |
| 9 | Master key rotated since secret stored | 500 with `master_key_rotation_detected` |
