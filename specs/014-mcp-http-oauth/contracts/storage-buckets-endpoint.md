# Contract — `GET /v1/projects/:ref/storage/buckets` (US5)

**Purpose**: Reverse-proxies the per-project storage container's bucket-list endpoint. Backs upstream MCP `list_storage_buckets` tool.

**Auth**: PAT or OAuth Bearer. RBAC: `instance.read` (existing — buckets are operator-visible metadata).

## Request

```http
GET /v1/projects/<ref>/storage/buckets
Authorization: Bearer <PAT or OAuth JWT>
```

No body, no query params.

## Response (success)

```http
HTTP/1.1 200 OK
Content-Type: application/json

[
  {
    "id": "avatars",
    "name": "avatars",
    "public": true,
    "file_size_limit": 5242880,
    "allowed_mime_types": ["image/png", "image/jpeg"],
    "created_at": "2026-01-15T10:00:00.000Z",
    "updated_at": "2026-01-15T10:00:00.000Z"
  },
  {
    "id": "private-docs",
    "name": "private-docs",
    "public": false,
    "file_size_limit": null,
    "allowed_mime_types": null,
    "created_at": "2026-02-01T09:00:00.000Z",
    "updated_at": "2026-02-01T09:00:00.000Z"
  }
]
```

Bare array (matches storage container's native `/storage/v1/bucket` response shape; same convention as feature 013's `database/query` bare-array).

## Implementation flow

1. Auth check.
2. RBAC check (`instance.read`).
3. Resolve instance row → confirm status `running`.
4. Mint per-project service-role JWT (cached for 24h per Decision 10):
   - Decrypt `encryptedSecrets.jwtSecret` via `loadMasterKey()`.
   - Sign HS256 with claims `{ role: "service_role", iss: "supabase", iat, exp = now + 24h }`.
5. `fetch('http://selfbase-<ref>-storage-1:5000/bucket', { headers: { 'Authorization': 'Bearer <service_role_jwt>' } })`.
6. Forward storage's JSON response verbatim. If storage returns 4xx/5xx, translate to selfbase error envelope.

## Validation rules

| Rule | Failure |
|---|---|
| Project status is `running` | 409 `project_not_runnable` |
| Per-project storage container is reachable | 503 `storage_unreachable` on TCP failure |
| Storage container's response is valid JSON | 502 `storage_bad_gateway` on parse failure |

## Error responses

```json
{ "message": "Cannot list buckets — project status is 'paused'", "code": "project_not_runnable", "details": { "status": "paused" } }
```

```json
{ "message": "storage container unreachable: connect ECONNREFUSED", "code": "storage_unreachable" }
```

```json
{ "message": "storage container returned invalid JSON", "code": "storage_bad_gateway" }
```

## Side effects

None beyond the audit emitted by the MCP layer (`mcp.tool.invoked` with `tool_name=list_storage_buckets`).

## Test obligations

- Valid request against project with 2 buckets → 200 + 2-element array (verify shape)
- Project with 0 buckets → 200 + `[]`
- Paused project → 409 `project_not_runnable`
- Storage container down → 503 `storage_unreachable`
- No auth → 401
- Member-role PAT → 200 (read-only; `instance.read` is allowed for members)
- Live-VM smoke: query buckets on a project that has at least one bucket → returns it correctly
- Service-role JWT caching: second request within 24h does NOT re-decrypt/sign (verify via mocked sign helper call count)
