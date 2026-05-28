# Feature 019 — `supabase backups list/restore` (async restore worker)

Closes issue #14.

## What shipped

### New Management API endpoints

| Method | Path                                                | Description                 |
| ------ | --------------------------------------------------- | --------------------------- |
| `GET`  | `/v1/projects/:ref/database/backups`                | List backups for CLI compat |
| `POST` | `/v1/projects/:ref/database/backups/restore-pitr`   | Initiate async restore      |
| `GET`  | `/v1/projects/:ref/database/backups/restore-status` | Poll restore job status     |

### New `restore_jobs` table

Tracks one restore job per project. Partial unique index enforces at-most-one in-flight restore per project (`status IN ('pending','running')`).

### New `'restoring'` instance status

`supabase_instances.status` now includes `'restoring'`. The health-reconciler skips rows in this state (restore worker owns them).

### New BullMQ workers

- **`selfbase.restore`** — full state machine: stop stack → snapshot data dir → extract backup → start stack → verify → success or rollback.
- **`selfbase.restore-gc`** — fires 24h after success; deletes the pre-restore snapshot.

### Disk-space pre-flight

The API checks `available_bytes >= 2 × data_dir_bytes` before enqueuing a restore. Returns `409 disk_space_insufficient` with `{ required_bytes, available_bytes, data_dir_bytes }` if insufficient.

### Rollback guarantee

If the worker fails or times out at any point after snapshotting the data dir, it automatically:

1. Stops the stack
2. Swaps the pre-restore snapshot back
3. Restarts the stack
4. Marks the job `failed` with the error reason

## Operator notes

- Restore is admin-only (`backup.restore` RBAC action).
- The pre-restore snapshot lives at `<data_dir>.pre-restore-<job_id>` until GC fires (24h) or a failed rollback consumes it.
- Run the new migration `0015_restore_jobs.sql` on the control-plane DB.
- No new env vars required.

## E2E test

```bash
SELFBASE_APEX=supaviser.dev \
SELFBASE_PAT='<admin PAT>' \
SELFBASE_TEST_PROJECT_REF='<ref>' \
bash tests/cli-e2e/backups-restore.sh
```
