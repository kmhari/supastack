# Contracts: Platform Stub Conversions (Tier 1–4)

All endpoints are in `GET|DELETE|PUT|POST /platform/projects/:ref/...` and `/platform/database/:ref/...`.
Auth: Bearer PAT via `requireAuth`. 401 on unauthenticated. 404 on unknown or unauthorized ref.

---

## Tier 1 — Status Endpoints

### GET /platform/projects/:ref/pause/status

```json
// 200 — project paused
{ "initiated_at": "2026-06-07T10:00:00.000Z", "status": "not_pausing" }

// 200 — project running/provisioning/other (no pause in progress)
{ "initiated_at": null, "status": "not_pausing" }

// 404 — ref unknown or user not in project's org
{ "error": "Project not found" }
```

### GET /platform/projects/:ref/readonly

```json
// 200 — project paused
{ "enabled": true }

// 200 — project running
{ "enabled": false }
```

### DELETE /platform/projects/:ref/readonly

Triggers resume workflow (idempotent). Delegates to `POST /v1/projects/:ref/restore`.

```json
// 200 — resume enqueued (project object)
{ "id": "...", "name": "...", "status": "COMING_UP", ... }

// 409 — already running
{ "message": "Cannot restore from status 'running'" }
```

### GET /platform/projects/:ref/upgrade/status

```json
// 200 — restoring
{ "status": "upgrading" }

// 200 — any other state
{ "status": "not_upgrading" }
```

---

## Tier 2 — Audit & Activity

### GET /platform/projects/:ref/audit

Query params: `rows` (default 50, max 200), `page` (default 1).

```json
// 200
{
  "result": [
    {
      "id": "42",
      "action": "instance.pause",
      "actor_id": "uuid",
      "actor_email": "admin@example.com",
      "target_kind": "instance",
      "target_id": "bbbbbbbbbbbbbbbbbbbb",
      "metadata": {},
      "created_at": "2026-06-07T10:00:00.000Z"
    }
  ],
  "count": 1
}

// 200 — no events
{ "result": [], "count": 0 }
```

### GET /platform/projects/:ref/activity

Ordered ascending (oldest first). Raw array.

```json
// 200
[
  { "id": "1", "action": "instance.create", "created_at": "...", ... }
]

// 200 — no events
[]
```

---

## Tier 3a — Downloadable Backups

### GET /platform/database/:ref/backups/downloadable-backups

```json
// 200
{
  "backups": [
    {
      "id": 1,
      "inserted_at": "2026-06-07T02:00:00.000Z",
      "completed_at": "2026-06-07T02:05:00.000Z",
      "size_bytes": 1048576,
      "isPhysicalBackup": true,
      "status": "COMPLETED"
    }
  ]
}

// 200 — no completed backups
{ "backups": [] }
```

---

## Tier 3b — Delegation Endpoints

These delegates pass the response verbatim from `/v1/...`. 401/404 from /v1 are forwarded.

### GET/DELETE /platform/projects/:ref/network-bans

Delegates to `/v1/projects/:ref/network-bans`. Current /v1 response (stub):
```json
{ "banned_ipv4_addresses": [] }  // GET
// 204 no content                // DELETE
```

### GET /platform/projects/:ref/network-restrictions

Delegates to `/v1/projects/:ref/network-restrictions`. Current /v1 response (stub):
```json
{ "entitlement": "disallowed", "config": { "dbAllowedCidrs": [], "dbAllowedCidrsReadReplicas": [] }, "old_config": null }
```

### POST /platform/projects/:ref/network-restrictions/apply

Delegates to `/v1/projects/:ref/network-restrictions/apply`.

### GET/PUT /platform/projects/:ref/ssl-enforcement

Delegates to real `/v1` handler (`ssl-enforcement.ts`).
```json
// GET 200
{ "currentConfig": { "database": false }, "appliedSuccessfully": true }

// PUT body
{ "requestedConfig": { "database": true } }
// PUT 200
{ "currentConfig": { "database": true }, "appliedSuccessfully": true }
```

### GET/POST /platform/projects/:ref/functions/secrets

Delegates to real `/v1/projects/:ref/secrets`.
```json
// GET 200
[{ "name": "MY_SECRET", "value": "sha256:<hash>" }]

// POST body
[{ "name": "MY_SECRET", "value": "s3cr3t" }]
// POST 201
{ "message": "All secrets stored" }
```

---

## Tier 4 — Lint Queries

### GET /platform/projects/:ref/run-lints

```json
// 200 — results
[
  {
    "name": "no_rls",
    "title": "Tables Without Row Level Security",
    "level": "WARN",
    "description": "Tables in the public schema without RLS enabled",
    "metadata": { "table": "my_table", "schema": "public" }
  }
]

// 200 — all checks pass
[]

// 503 — project not running
{ "error": "Project is not running", "code": "project_not_running" }
```

### GET /platform/projects/:ref/run-lints/:name

Same shape as above but filtered to the named check. Returns `[]` for unknown check names.
