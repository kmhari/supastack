# Contract: Tenant Registration (supastack api ↔ supavisor admin API)

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23

The supastack `api` is the only writer to supavisor's tenant table. All tenant CRUD ops go through supavisor's HTTP admin API at `http://supavisor:4000/api/tenants`.

---

## Authentication

All requests require `Authorization: Bearer <JWT>` where the JWT is:
- Algorithm: HS256
- Secret: `SUPAVISOR_API_JWT_SECRET` (env, shared between api container and supavisor container)
- Claims: `{ "role": "admin", "iat": <now>, "exp": <now + 300> }`
- Minted per request (5 minute TTL, no cache needed at our scale)

---

## POST /api/tenants — Register a tenant

**Called by**: `apps/api/src/services/pooler-tenants.ts → registerTenantForInstance(ref)` inside the same DB transaction that creates a `supabase_instances` row.

**Request body**:
```json
{
  "tenant": {
    "external_id": "abcdefghijklmnopqrst",
    "db_host": "host.docker.internal",
    "db_port": 30005,
    "db_database": "postgres",
    "default_pool_size": 20,
    "default_max_clients": 100,
    "require_user": false,
    "auth_query": "SELECT * FROM pgbouncer.get_auth($1)",
    "sni_hostname": "db.abcdefghijklmnopqrst.supaviser.dev",
    "users": [
      {
        "db_user": "postgres",
        "db_password": "<plaintext-postgres-password>",
        "mode_type": "transaction",
        "pool_size": 20,
        "is_manager": true
      }
    ]
  }
}
```

**Response 201**:
```json
{
  "data": {
    "external_id": "abcdefghijklmnopqrst",
    "inserted_at": "2026-05-23T12:00:00Z"
  }
}
```

**Error responses**:
- `409` — tenant with this `external_id` already exists → treat as success (idempotent)
- `422` — validation error → bubble up; api wraps in `errors.invalidInput`
- `5xx` — transient → api retries up to 3 times with backoff; on final failure, rolls back the provision transaction

**Supastack post-actions** (in transaction, after 2xx response):
1. `UPDATE pooler_tenants SET status='active', last_error=NULL WHERE external_id=$1`
2. `INSERT INTO pooler_events (tenant_id, external_id, event, detail) VALUES (..., ..., 'register', '{"sni":"..."}')`
3. `INSERT INTO audit_log (action) VALUES ('pooler.tenant.register')`

---

## DELETE /api/tenants/{external_id} — Unregister a tenant

**Called by**: `apps/api/src/services/pooler-tenants.ts → unregisterTenantForInstance(ref)` inside the instance-delete transaction.

**Response 204**: success (no body).

**404 handling**: tenant didn't exist → treat as success (idempotent).

**Supastack post-actions**:
1. `DELETE FROM pooler_tenants WHERE external_id=$1` (CASCADE deletes pooler_events)
2. `INSERT INTO audit_log (action) VALUES ('pooler.tenant.unregister')`

---

## GET /api/tenants — List all tenants

**Called by**: reconciler + dashboard health panel.

**Response 200**:
```json
{
  "data": [
    {
      "external_id": "abcdefghijklmnopqrst",
      "sni_hostname": "db.abcdefghijklmnopqrst.supaviser.dev",
      "default_pool_size": 20,
      "default_max_clients": 100,
      "inserted_at": "2026-05-23T12:00:00Z"
    }
  ]
}
```

---

## GET /api/tenants/{external_id} — Get one tenant

**Used by**: reconciler (to detect drift in pool config).

**Response 200**: single tenant object (same shape as list element + nested `users` array).
**Response 404**: tenant not found.

---

## PUT /api/tenants/{external_id} — Update tenant config

**Called by**: dashboard "update pool size" action; reconciler when password rotates.

**Request body**: partial — only fields being changed (e.g., `{"default_pool_size": 40}` or `{"users": [{"db_password": "new-pass"}]}`).

**Response 200**: updated tenant object.

---

## GET /metrics — Prometheus-format metrics

**Called by**: dashboard health panel (proxied via `apps/api/src/routes/pooler-health.ts`).

**Format**: standard Prometheus exposition. Key metrics:
- `supavisor_pool_checkouts_total{tenant="..."}`
- `supavisor_pool_size{tenant="..."}`
- `supavisor_pool_in_use{tenant="..."}`
- `supavisor_pool_queue_length{tenant="..."}`
- `supavisor_db_connections{tenant="..."}`

**API endpoint**: `apps/api/src/routes/pooler-health.ts` parses the Prometheus text into a structured JSON for the dashboard.

---

## GET /api/health — Liveness probe

**Called by**: docker compose healthcheck + supastack api's reconciler.

**Response 200**: `{"status": "ok", "version": "2.7.4"}`.
**Anything else**: supavisor unhealthy.

---

## Atomicity & Error Recovery

**Provision flow** (`POST /api/v1/instances`):
```ts
await db().transaction(async (tx) => {
  // 1. Insert supabase_instances row
  const inst = await tx.insert(schema.supabaseInstances).values({...}).returning();
  
  // 2. Insert pooler_tenants row with status='registering'
  const tenant = await tx.insert(schema.poolerTenants).values({
    instanceRef: inst.ref, externalId: inst.ref, sniHostname: '...',
    status: 'registering',
  }).returning();
  
  // 3. Call supavisor HTTP API (outside DB but inside tx)
  //    Throws on failure → entire tx rolls back
  await poolerClient.registerTenant({...});
  
  // 4. Update tenant row to active
  await tx.update(schema.poolerTenants)
    .set({ status: 'active', lastError: null })
    .where(eq(schema.poolerTenants.id, tenant.id));
});
// 5. Enqueue provision job (existing behavior)
```

**Failure mode**: if step 3 throws after, say, 2 retries with backoff:
- Transaction rolls back → no `supabase_instances` row, no `pooler_tenants` row
- Operator sees error: "Pooler registration failed: <message>"
- No partial state on disk or in supavisor

**Reconciler catches the edge case** where step 3 succeeded but the post-action rollback happened (e.g., DB connection died between step 3 and step 4): the supavisor tenant exists but no `pooler_tenants` row matches it → reconciler unregisters from supavisor.
