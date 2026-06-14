# Pooler resilience

Operator runbook for the daily pooler reconciler, the pooler status API, and PG password drift recovery.

If `GET /api/v1/pooler/status` says every tenant is `active` and supavisor is up, nothing here applies to you. Come back when you see drift.

## What the reconciler does

A BullMQ job runs **daily at 03:00 UTC** comparing three sources of truth:

| Source                               | What it knows                                                 |
| ------------------------------------ | ------------------------------------------------------------- |
| `supabase_instances`                 | Which projects should exist (their refs + statuses)           |
| `pooler_tenants` (supastack)         | Which projects supastack thinks are registered with supavisor |
| `GET /api/tenants/<ref>` (supavisor) | Which projects are actually registered with supavisor         |

Per-project classification + remediation:

| Classification         | Detection                                                       | Action                                                                 |
| ---------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `consistent`           | All three agree                                                 | No-op (no event emitted — operator never sees these)                   |
| `missing_pooler_row`   | Instance exists; no row in `pooler_tenants`                     | Re-register tenant                                                     |
| `missing_in_supavisor` | Tenant says `active` but supavisor doesn't have it              | Re-register tenant                                                     |
| `failed_stale`         | Tenant `status='failed'` for over 1h                            | Retry register; on auth-class failure → flip to `pg_password_drift`    |
| `instance_gone`        | Tenant row + supavisor entry but instance is `deleting` or gone | Unregister from supavisor + delete the row                             |
| `orphan_in_supavisor`  | Supavisor has a tenant we don't know about                      | Unregister from supavisor                                              |
| `pg_password_drift`    | Registration auth-failed and active probe confirms              | Status stays `pg_password_drift`; reset via reset-pg-password endpoint |

**The reconciler is silent when nothing is drifting.** No `pooler_events` rows for the consistent path, no banners, minimal log volume. If your `recent_events` tail is empty, that's healthy.

## Manual trigger

You don't have to wait for 03:00 UTC. By API (admin-only):

```bash
curl -X POST -H "Authorization: Bearer $PAT" \
  https://<apex>/api/v1/pooler/reconciler/run
```

If a run is already in flight, you'll get a 409 with the in-flight `run_id` + `started_at`. Wait for it to finish (typically <2s for a no-op, <10s for a sweep with drift).

## Reading pooler status

`GET /api/v1/pooler/status` (admin token) returns everything in one payload:

| Field                | Meaning                                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| supavisor health     | Whether supavisor's `/api/health` responds. Down ⇒ new pooled connections fail — check `docker compose logs supavisor`.                                                      |
| endpoint             | The string apps should connect to: `pooler.<apex>:6543`                                                                                                                      |
| per-project rows     | instance status (`running`/`paused`/…), tenant status (`active`/`failed`/`pg_password_drift`/`registering`), whether supavisor actually has the tenant, last-reconciled time |
| recent runs + events | See the next two sections                                                                                                                                                    |

Per-project remediation endpoints: `POST /api/v1/pooler/tenants/<ref>/re-register`
(synchronously retries registration) and
`POST /api/v1/instances/<ref>/reset-pg-password` (only relevant for
`pg_password_drift` — see the drift recovery section).

### Recent reconciler runs

Last 30 runs. Each row shows:

- `started_at`, status (`success` / `partial_failure` / `failed` / `running`)
- `instances_seen` (how many projects were checked)
- `actions_taken` (e.g., `missing_pooler_row: 1`)
- `trigger_source` (`cron` or `manual`)

A `partial_failure` run isn't an emergency — it means ≥1 per-instance reconciliation failed but the rest succeeded. Look at events for that ref's `reconciler.*` entries to see why.

### Recent events tail

Last 50 entries. Filter mentally by event type:

| Event                                                               | Meaning                                                                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `reconciler.registered_missing`                                     | Reconciler created a missing tenant. Normal recovery.                                                              |
| `reconciler.retry_succeeded`                                        | A previously-failed tenant retried and is now active.                                                              |
| `reconciler.retry_failed`                                           | Retry still failing — the project's tenant is stuck. Investigate.                                                  |
| `reconciler.password_drift_detected`                                | Active probe confirmed the stored password doesn't match the live PG. Operator action needed → see drift recovery. |
| `reconciler.unregistered_deleting`                                  | Reconciler cleaned up after an instance was deleted.                                                               |
| `reconciler.unregistered_orphan`                                    | Supavisor had a tenant we didn't — cleaned up.                                                                     |
| `password_reset_then_registered`                                    | Operator ran reset-pg-password + reconciler verified successfully.                                                 |
| `register` / `register_failed` / `unregister` / `unregister_failed` | Per-tenant lifecycle events from provisioning/deletion.                                                            |

## PG password drift recovery

### What `pg_password_drift` means

The per-instance Postgres's `postgres` role's on-disk password no longer matches what's stored in `encrypted_secrets.postgresPassword`. The most common cause: `POSTGRES_PASSWORD` is only honored on first init, so a leftover data dir from a prior failed provision leaves the role with whatever password the original bootstrap used, ignoring the env var.

When this happens:

- Pooler registration auth-fails
- Direct connections via `db.<ref>.<apex>:5432` with the stored password fail
- `supabase db push --linked` fails
- Studio's connection string is incorrect

### Recovery

Call the reset endpoint (next section) for the drifted project. Within ~5 seconds the tenant status should return to `active`.

What happens under the hood:

1. Admin RBAC check (`instance.pg-password.reset` permission)
2. Audit log entry emitted (`instances.pg_password.reset`, severity `high`)
3. `docker exec` into `supastack-<ref>-db-1` running `psql -h 127.0.0.1 -U supabase_admin` (trust auth from inside the container)
4. `BEGIN; ALTER USER postgres WITH PASSWORD '<from secret>'; ALTER USER supabase_admin WITH PASSWORD '<from secret>'; COMMIT;`
5. Enqueue a single-instance reconciler pass with high priority
6. Poll the `reconciler_runs` row for up to 5 seconds
7. Return final `pooler_tenant_status` in the response

### Recovery via CLI

```bash
curl -X POST -H "Authorization: Bearer $PAT" \
  https://<apex>/api/v1/instances/<ref>/reset-pg-password
```

Response:

```json
{
  "ref": "...",
  "reset_at": "...",
  "message": "Password reset successfully; verified.",
  "pooler_tenant_status": "active",
  "reconciler_run_id": "..."
}
```

### When it doesn't work

| Symptom                                  | Likely cause                                   | Fix                                                         |
| ---------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| 502 `per_instance_db_unreachable`        | Per-instance db container is down              | `docker compose -p supastack-<ref> up -d db`, then retry    |
| 409 `project_not_running`                | Project is `paused` or `deleting`              | Resume the project first                                    |
| 500 `master_key_rotation_detected`       | Master key changed since the secret was stored | Out of scope — re-mint instance secrets                     |
| Reset succeeds but tenant still `failed` | Different root cause (supavisor down, network) | Look at the latest `register_failed` event's `detail.error` |

## Prevention at provision time

Since this feature, the provision worker actively verifies the per-instance Postgres accepts the stored password BEFORE marking the instance `running`. The probe retries 3× with 2s delay (handles healthcheck/auth race conditions).

If the probe fails with auth-class error, the provision fails with:

```
provision_error = 'pg_password_drift_at_provision — per-instance Postgres rejected the stored password after 3 attempts. Likely a leftover data dir bootstrapped with a different password. Recover via POST /api/v1/instances/<ref>/reset-pg-password then retry provision.'
```

Recovery: run the reset endpoint, then trigger lifecycle "retry-provision".

## Implementation notes

- **Single in-flight reconciler run** enforced by partial unique index on `reconciler_runs(status) WHERE status = 'running'`. Concurrent triggers get 409.
- **Stale run cleanup**: at the start of every tick, runs older than 1h in `running` state get flipped to `failed` with `error='worker_crash_detected'`.
- **Retention**: last 30 reconciler_runs rows kept; older trimmed at the start of each tick.
- **Self-contained worker**: the reconciler service in `apps/worker/src/services/pooler-reconciler.ts` inlines its own supavisor HTTP client + per-instance PG probe so worker doesn't depend on api. The api side just enqueues jobs + polls the `reconciler_runs` row.
- **Active probe is authoritative for drift classification** — pattern-matching supavisor's error strings is unreliable across versions (`%DBConnection.ConnectionError{...}` doesn't say "28P01"). The reconciler always probes per-instance PG to confirm before flipping status to `pg_password_drift`.

## Related

- Pooler endpoint reference: `pooler.<apex>:6543`, username `postgres.<ref>` — see
  [supabase-cli.md](./supabase-cli.md) for the client-side picture.
