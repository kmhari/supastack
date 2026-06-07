# Contract: Platform Proxy Endpoints (Feature 111)

All six endpoints are delegations or semantic corrections. Response shapes come from the v1 delegation target verbatim (no transformation). Exceptions noted below.

---

## GET /platform/projects/:ref/api/rest

**Delegates to**: `GET /v1/projects/:ref/postgrest`

**Response (200)**:
```json
{
  "db_schema": "public",
  "db_extra_search_path": "public,extensions",
  "max_rows": 1000,
  "db_pool": 15
}
```

**Error responses**:
- `401 { "error": "Unauthorized" }` — missing/invalid token
- `404 { "message": "Project not found", ... }` — propagated from v1

---

## GET /platform/projects/:ref/postgres-config

**Delegates to**: `GET /v1/projects/:ref/config/database/postgres`

**Response (200)**:
```json
{
  "effective_cache_size": "4096MB",
  "maintenance_work_mem": "64MB",
  "max_connections": 100,
  "shared_buffers": "1024MB",
  "work_mem": "16MB"
}
```
(Actual field set and values come from postgres-config-store)

**Error responses**: 401, 404 (propagated from v1)

---

## PATCH /platform/projects/:ref/postgres-config

**Delegates to**: `PATCH /v1/projects/:ref/config/database/postgres`

**Request body**: Same shape as v1 PATCH (subset of config fields)

**Response (200)**: Updated config object (verbatim from v1)

**Error responses**: 400 validation errors, 401, 404 (propagated)

---

## DELETE /platform/projects/:ref/functions/secrets

**Delegates to**: `DELETE /v1/projects/:ref/secrets`

**Request body**: `{ "secrets": ["SECRET_NAME"] }` (or array of name strings depending on v1 shape)

**Response**: Status + body verbatim from `DELETE /v1/projects/:ref/secrets`

**Error responses**: 401, propagated from v1

---

## DELETE /v1/projects/:ref/api-keys/:id

**Behavior**: Always 404 on self-hosted (no custom API key store exists).

**Response (404)**:
```json
{
  "message": "API key not found",
  "code": "not_found",
  "metadata": { "id": "<id>" }
}
```

**Project not found (404)**:
```json
{
  "message": "Project not found",
  "code": "not_found",
  "metadata": { "ref": "<ref>" }
}
```

**Error responses**: 401, 404

---

## PATCH /v1/projects/:ref/api-keys/:id

**Behavior**: Always 404 on self-hosted (no custom API key store exists).

**Response (404)**: Same shape as DELETE above.

**Error responses**: 401, 404
