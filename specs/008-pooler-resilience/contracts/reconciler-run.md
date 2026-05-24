# Contract: `POST /api/v1/pooler/reconciler/run`

Manual trigger for a full reconciler sweep. Returns the run id; the actual reconciliation runs in the worker.

## Request

```
POST /api/v1/pooler/reconciler/run
Cookie: session=<admin>
```

Admin-only. No body.

## Response 202 (accepted)

```json
{
  "run_id": "uuid",
  "status": "running",
  "started_at": "2026-05-24T03:00:00Z",
  "message": "Reconciler run started. Poll /api/v1/pooler/status for live state."
}
```

## Response 409 (already running)

```json
{
  "error": {
    "code": "previous_run_still_active",
    "message": "Another reconciler run is already in progress.",
    "details": {
      "run_id": "uuid",
      "started_at": "2026-05-24T02:59:30Z"
    }
  }
}
```

## Response 403
Non-admin.

## Behavior

1. RBAC: admin only.
2. INSERT row into `reconciler_runs` with `status='running'`, `trigger_source='manual'`, `actor_id=<user>`. The partial unique index gates concurrency → 409 on conflict (the duplicate detect message includes the in-flight run id).
3. Enqueue the BullMQ `pooler-reconciler` job with priority +10 (above scheduled runs).
4. Emit audit log `pooler.reconciler.manual_trigger`.
5. Return 202 with the run id.

The worker eventually picks up the job and updates the row's `status` to `success` / `partial_failure` / `failed`. Operator polls `/api/v1/pooler/status` to see updates (via the `recent_runs` array).

## Test cases

| # | Scenario | Expected |
|---|---|---|
| 1 | No run in flight | 202, new row, job enqueued |
| 2 | Cron run already running | 409 `previous_run_still_active` |
| 3 | Stale `running` row (>1h old) | 202, stale row marked failed first, new run starts |
| 4 | Non-admin | 403 |
