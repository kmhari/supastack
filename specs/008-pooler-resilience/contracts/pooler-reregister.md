# Contract: `POST /api/v1/pooler/tenants/:ref/re-register`

Synchronous re-registration of a single tenant. Operator-facing alternative to waiting for the next reconciler tick.

## Request

```
POST /api/v1/pooler/tenants/<ref>/re-register
Cookie: session=<admin>
```

Admin-only. No body.

## Response 200 (success)

```json
{
  "ref": "enzyxdtrbosuwjwzkmvl",
  "tenant_status": "active",
  "last_error": null,
  "duration_ms": 320
}
```

## Response 200 (still failing, classification updated)

```json
{
  "ref": "asyobqcbycmqjeribjfv",
  "tenant_status": "pg_password_drift",
  "last_error": "auth probe failed: 28P01",
  "duration_ms": 1450
}
```

(Re-register can SUCCEED at classifying drift even if registration itself failed — that's a useful outcome the dashboard reflects.)

## Response 403 / 404 / 409

- 403: non-admin
- 404: ref doesn't exist
- 409: instance not `running` (`provisioning`, `paused`, `deleting`, `failed`)

## Behavior

1. RBAC: admin only.
2. Load instance; 404 if not found, 409 if not `running`.
3. Call `registerTenantForInstance(ref)` (existing pooler-tenants service, with the new auth-failure classification logic from FR-015).
4. Return the resulting `pooler_tenants` row.

## Performance

p95 < 5 s. Bounded by supavisor's register call + (on failure) one extra per-instance PG probe.

## Test cases

| # | Scenario | Expected |
|---|---|---|
| 1 | Healthy project, re-register | 200, status `active`, fast |
| 2 | Drifted project, re-register | 200, status `pg_password_drift`, probe ran |
| 3 | Supavisor down | 200 with status `failed`, `last_error` describing the supavisor issue |
| 4 | Instance is paused | 409 |
| 5 | Unknown ref | 404 |
| 6 | Non-admin | 403 |
