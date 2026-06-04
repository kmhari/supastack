# Contract — Migrate the real backup engine to the platform studio (US6)

Adapter over the existing engine (`backups` table, `initiateRestore` + `selfbase.restore` queue + `handleRestore` worker). Emits the **vendored-Studio Cloud shape** (pinned studio commit `8cd39680ef`). The `/v1` CLI backup contract (uuid, lowercase) is untouched (Constitution IV).

## Migration (idempotent, additive)

`packages/db/migrations/00NN_backup_seq.sql`:
```sql
ALTER TABLE backups ADD COLUMN IF NOT EXISTS seq bigint;
-- backfill + make it identity/auto so new rows get a stable numeric id
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'backups_seq_seq') THEN
    CREATE SEQUENCE backups_seq_seq OWNED BY backups.seq;
  END IF;
END $$;
UPDATE backups SET seq = nextval('backups_seq_seq') WHERE seq IS NULL;
ALTER TABLE backups ALTER COLUMN seq SET DEFAULT nextval('backups_seq_seq');
CREATE UNIQUE INDEX IF NOT EXISTS backups_seq_uniq ON backups (seq);
```
Native `id` stays uuid (CLI contract). `seq` is the numeric surrogate the studio sees. Re-runnable.

## `GET /platform/database/:ref/backups` (replaces stub at platform-misc.ts:650-653)

`app.requireAuth(req)` + org-membership check + `app.authorize(req,'backup.list')`. Returns the Studio shape:
```jsonc
{
  "region": "local",
  "pitr_enabled": false,
  "walg_enabled": false,
  "backups": [
    { "isPhysicalBackup": true, "id": <seq:number>, "inserted_at": "<startedAt ISO>",
      "status": "COMPLETED", "project_id": <stable int hash of ref> }
  ],
  "physicalBackupData": {
    "earliestPhysicalBackupDateUnix": <unix-sec | null>,
    "latestPhysicalBackupDateUnix": <unix-sec | null>
  }
}
```
Map native `status`: `completed→COMPLETED`, `failed→FAILED`, `running→PENDING` (or filter `running`, as `listBackupsForCli` does). `id` = `seq` (number). New `listBackupsForPlatform(ref)` in `backups-mgmt-service.ts` (do NOT reuse `listBackupsForCli` — that's the snake_case ISO CLI shape).

## `POST /platform/database/:ref/backups/restore-physical` (replaces no-op at platform-misc.ts:1946-1949)

Body `{ id: <seq:number> }`. `app.authorize(req,'backup.restore')`. Resolve `seq → native uuid` (the backup row for this ref), then **reuse the engine**: `initiateRestore(ref, { backup_id: <uuid> })` → `restoreQueue().add('restore', { restore_job_id })` (queue `selfbase.restore`) → `reply.status(201).send()` (no body). Map `RestoreError` codes to HTTP as `backups-mgmt.ts` does (409 on in-flight, 404 on missing/`seq` not found, etc.). The restore runs in the worker; the api only enqueues (Constitution V).

> Also wire the sibling `/platform/database/:ref/backups/restore` no-op (platform-misc.ts:1941-1944) to the same path (Studio posts there for non-physical), or document why it's deferred.

## `GET /platform/projects/:ref/status` (NEW — does not exist)

`app.requireAuth(req)` + org-membership check. Returns `{ status: inst.status === 'running' ? 'ACTIVE_HEALTHY' : inst.status.toUpperCase() }` (existing repo idiom). During a restore `inst.status='restoring'` → `RESTORING`; after the worker completes it's `running` → `ACTIVE_HEALTHY`. Model on the `/platform/projects/:ref` detail handler (platform-misc.ts:378-397) for org-scoping.

## Acceptance

- List returns real backups with numeric `seq` ids; empty `backups[]` for a project with none (wrapper fields present).
- Restore with `{id:seq}` → 201, a `restore_jobs` row is created + a `selfbase.restore` job enqueued; `supabase_instances.status` goes `restoring`; worker completion returns it to `running`.
- `GET /platform/projects/:ref/status` returns `RESTORING` mid-restore, `ACTIVE_HEALTHY` after.
- `id` round-trips: the `seq` returned by the list resolves back to the native uuid on restore.
- `/v1/projects/:ref/database/backups*` (CLI, uuid) responses are unchanged.
