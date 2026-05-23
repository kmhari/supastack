# Contract: Pooler Health API (dashboard ↔ selfbase api)

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23

The dashboard polls a selfbase api endpoint that proxies + aggregates supavisor's health/metrics data into a stable shape. The dashboard never talks to supavisor directly.

---

## GET /api/pooler/health

**Auth**: `org.read` (any authenticated org member)

**Purpose**: Render the "Database Connection Pooler" panel on Settings → Database.

**Server behaviour**:
1. Probe `http://supavisor:4000/api/health` (timeout 2s)
2. If supavisor responds 200 → fetch `/api/tenants` and `/metrics`
3. Parse Prometheus metrics into per-tenant breakdown
4. Cross-reference with `pooler_tenants` table to identify orphan/missing tenants
5. Return JSON

**Response 200 — pooler healthy**:
```json
{
  "status": "healthy",
  "version": "2.7.4",
  "lastChecked": "2026-05-23T12:00:00Z",
  "summary": {
    "totalTenants": 3,
    "registeredInSelfbase": 3,
    "registeredInSupavisor": 3,
    "drift": 0,
    "activeConnections": 5,
    "totalPoolSize": 60
  },
  "tenants": [
    {
      "externalId": "abcdefghijklmnopqrst",
      "instanceRef": "abcdefghijklmnopqrst",
      "sniHostname": "db.abcdefghijklmnopqrst.supaviser.dev",
      "poolSize": 20,
      "maxClients": 100,
      "activeConnections": 3,
      "queuedRequests": 0,
      "registeredAt": "2026-05-23T11:30:00Z",
      "status": "active"
    }
  ]
}
```

**Response 200 — pooler degraded** (e.g. drift detected):
```json
{
  "status": "degraded",
  "version": "2.7.4",
  "lastChecked": "2026-05-23T12:00:00Z",
  "summary": {
    "totalTenants": 3,
    "registeredInSelfbase": 3,
    "registeredInSupavisor": 2,
    "drift": 1,
    "activeConnections": 5,
    "totalPoolSize": 60
  },
  "tenants": [...],
  "warnings": [
    {
      "severity": "warn",
      "code": "tenant_missing_from_supavisor",
      "message": "Instance abc... has a pooler_tenants row but is not registered in supavisor. Next reconciler tick will fix.",
      "instanceRef": "abc..."
    }
  ]
}
```

**Response 503 — pooler down**:
```json
{
  "status": "down",
  "version": null,
  "lastChecked": "2026-05-23T12:00:00Z",
  "error": "supavisor health endpoint returned 504",
  "recovery": {
    "steps": [
      "Check container logs: docker compose logs supavisor",
      "Restart: docker compose restart supavisor",
      "If persistent, see docs/pooler-troubleshooting.md"
    ]
  }
}
```

---

## POST /api/pooler/tenants/{ref}/re-register

**Auth**: `org.update`

**Purpose**: Force re-registration of a single tenant. Used by the dashboard "Retry registration" button on a tenant that failed automatic registration.

**Server behaviour**:
1. Load `supabase_instances` row by `ref`
2. Decrypt password
3. Call supavisor PUT /api/tenants/{external_id} (or DELETE + POST if PUT not supported for full re-register)
4. Update `pooler_tenants.status = 'active'`, clear `last_error`
5. Insert `pooler_events` with `event = 'reconcile_missing'` (manual trigger uses same event type)

**Response 200**: updated tenant detail (same shape as one element of `/api/pooler/health`'s `tenants` array).
**Response 404**: instance not found.
**Response 503**: supavisor unavailable.

---

## POST /api/pooler/tenants/{ref}/pool-size

**Auth**: `org.update`

**Purpose**: Operator adjusts pool size for one project from the dashboard.

**Request body**:
```json
{ "poolSize": 40, "maxClients": 200 }
```

**Server behaviour**:
1. Validate `poolSize` ≤ `maxClients`
2. Call supavisor PUT /api/tenants/{external_id} with the new values
3. Update `pooler_tenants.pool_size` + `max_clients`
4. Audit log

**Response 200**: updated tenant detail.

---

## Frontend Polling

The dashboard component (`PoolerHealthCard.tsx`) polls `/api/pooler/health` every 10 seconds while visible. Shows:
- Green badge "Healthy" / Yellow "Degraded with N warnings" / Red "Down"
- Total active connections / total pool capacity (visual progress bar)
- Per-tenant table: external_id, active/pool, queue length, status, [Re-register] button (if status≠active)

---

## Selfbase API Client (`apps/web/src/lib/api.ts`)

```ts
export const poolerApi = {
  health: () => unwrap<PoolerHealthResponse>(client.get('/pooler/health')),
  reregister: (ref: string) => unwrap(client.post(`/pooler/tenants/${ref}/re-register`)),
  setPoolSize: (ref: string, body: { poolSize: number; maxClients: number }) =>
    unwrap(client.post(`/pooler/tenants/${ref}/pool-size`, body)),
};
```

Zod types in `packages/shared/src/schemas.ts`: `PoolerHealthResponse`, `PoolerTenantStatus`, `PoolerWarning`.
