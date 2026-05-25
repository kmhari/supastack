# Contract: `GET /api/v1/pooler/status`

Powers the Settings → Database dashboard panel (US2).

## Request

```
GET /api/v1/pooler/status
Cookie: session=<admin>
```

Admin-only via existing RBAC.

## Response 200

```json
{
  "supavisor": {
    "reachable": true,
    "version": "2.7.4",
    "healthcheck_status": "up"
  },
  "endpoint": "pooler.supaviser.dev:6543",
  "projects": [
    {
      "ref": "enzyxdtrbosuwjwzkmvl",
      "name": "huntvox",
      "instance_status": "running",
      "tenant_status": "active",
      "last_error": null,
      "last_seen_in_supavisor": "2026-05-24T03:00:01Z",
      "last_reconciled_at": "2026-05-24T03:00:01Z",
      "registered_at": "2026-05-23T15:46:00Z"
    },
    {
      "ref": "asyobqcbycmqjeribjfv",
      "name": "pg-edge-test-2",
      "instance_status": "running",
      "tenant_status": "pg_password_drift",
      "last_error": "auth probe failed: 28P01 password authentication failed",
      "last_seen_in_supavisor": null,
      "last_reconciled_at": "2026-05-24T03:00:02Z",
      "registered_at": "2026-05-23T16:00:00Z"
    }
  ],
  "recent_events": [
    {
      "id": 1234,
      "ref": "asyobqcbycmqjeribjfv",
      "event": "reconciler.password_drift_detected",
      "detail": { "error": "28P01 ..." },
      "created_at": "2026-05-24T03:00:02Z"
    }
  ],
  "recent_runs": [
    {
      "id": "uuid",
      "started_at": "2026-05-24T03:00:00Z",
      "completed_at": "2026-05-24T03:00:03Z",
      "status": "partial_failure",
      "instances_seen": 2,
      "actions_taken": { "password_drift_detected": 1 },
      "trigger_source": "cron"
    }
  ]
}
```

## Response 403
Non-admin caller.

## Behavior

1. Resolve caller is admin via existing RBAC.
2. Concurrently fetch:
   - `supavisor.getHealth()` (existing pooler-client helper)
   - `supabase_instances` rows where `status != 'deleting'`
   - `pooler_tenants` (join)
   - Most recent 50 `pooler_events`
   - Most recent 30 `reconciler_runs`
3. Join + shape per contract.
4. Return.

If supavisor is unreachable (timeout 3s), return `{ supavisor: { reachable: false, ...}, ... }` — don't 500. Dashboard handles offline rendering.

## Performance

p95 < 1 s for ≤50 projects (SC-004). Bounded by the single supavisor health probe + parallel SELECTs.

## Test cases

| # | Scenario | Expected |
|---|---|---|
| 1 | Healthy deployment, 2 projects | 200, both rows `active`, recent_events empty if quiet |
| 2 | Project with `pg_password_drift` | 200, that row's tenant_status = `pg_password_drift`, last_error populated |
| 3 | Supavisor down | 200, `supavisor.reachable: false`; project rows still rendered |
| 4 | Non-admin user | 403 |
| 5 | Unauthenticated | 401 |
| 6 | Project in `provisioning` state | included with `tenant_status` = null (not yet registered) |
