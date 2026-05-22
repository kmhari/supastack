# Error envelope contract

Every error response from the `/v1/*` management surface MUST match this shape.
The upstream CLI's generated client (`pkg/api/types.gen.go`) deserializes errors
by reading `message`; a missing or wrong-shaped envelope produces a Go reflect
error visible to the user as `Try rerunning the command with --debug` — terrible UX.

## Schema

```ts
interface ErrorEnvelope {
  message: string;       // required, human-readable, the CLI displays this verbatim
  code?: string;         // machine-readable category; stable across versions
  details?: object;      // optional structured detail; unused by the CLI today, useful for our own dashboards
}
```

## Status codes selfbase emits

| Status | Code (suggested) | When |
|---|---|---|
| `400` | `bad_request` | Malformed JSON, missing required field, unknown content type. |
| `401` | `unauthorized` | Missing/invalid/expired/revoked PAT. |
| `403` | `forbidden` | PAT is valid but doesn't have access to this project (cross-org). |
| `404` | `not_found` | Project, function, or secret doesn't exist. |
| `409` | `reserved_name` / `conflict` | Secret name in reserved list; concurrent deploy collision. |
| `413` | `payload_too_large` | Upload exceeded the 50 MB cap. |
| `422` | `validation` | Slug regex failed; entrypoint_path didn't match any file part; secret name regex failed. |
| `500` | `internal` / `deploy_rolled_back` | Disk write failed; container restart timed out and was rolled back. |
| `501` | `not_implemented` | Endpoint exists upstream but selfbase P0 doesn't implement it. |

## Examples

### Missing PAT

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{
  "message": "Unauthorized",
  "code": "unauthorized"
}
```

### Project not found (CLI uses this for "Cannot find project" on `link`)

```http
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "message": "Project not found",
  "code": "not_found",
  "details": {
    "ref": "abcdefghijklmnopqrst"
  }
}
```

### Reserved secret name

```http
HTTP/1.1 409 Conflict
Content-Type: application/json

{
  "message": "Cannot set reserved secret: JWT_SECRET. This name is managed by the platform.",
  "code": "reserved_name",
  "details": {
    "name": "JWT_SECRET"
  }
}
```

### Bundle too large

```http
HTTP/1.1 413 Payload Too Large
Content-Type: application/json

{
  "message": "Function bundle exceeds 50 MB limit (received 67108864 bytes)",
  "code": "payload_too_large",
  "details": {
    "limit_bytes": 52428800,
    "received_bytes": 67108864
  }
}
```

### Slug fails regex

```http
HTTP/1.1 422 Unprocessable Entity
Content-Type: application/json

{
  "message": "Function slug 'Hello World!' is invalid. Must match ^[a-z0-9][a-z0-9-]{0,47}$",
  "code": "validation",
  "details": {
    "field": "slug",
    "value": "Hello World!"
  }
}
```

### Not implemented (FR-024)

```http
HTTP/1.1 501 Not Implemented
Content-Type: application/json

{
  "message": "This management endpoint is not implemented in selfbase. The 'branches' API is cloud-only. See https://supaviser.dev/docs/cli-compat for the supported subset.",
  "code": "not_implemented",
  "details": {
    "path": "/v1/projects/abcdefghijklmnopqrst/branches",
    "upstream_only": true
  }
}
```

### Rolled-back deploy

```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "message": "Deploy of function 'hello' was rolled back: the functions container failed to restart in time. The previous version is still serving traffic.",
  "code": "deploy_rolled_back",
  "details": {
    "slug": "hello",
    "prior_version": 3
  }
}
```

## Implementation

Single Fastify error formatter under `apps/api/src/plugins/mgmt-api-errors.ts`,
scoped to the management route group via `app.register(mgmtErrorPlugin, { prefix: '/v1' })`.
The plugin:

1. Catches Fastify's built-in validation errors (Zod via `fastify-type-provider-zod` or `@fastify/swagger`) and remaps them to `{ message, code: "validation", details: { issues: zodIssues } }`.
2. Catches uncaught exceptions and converts to `{ message: error.message, code: "internal" }` (logs the stack server-side).
3. Catches our domain errors (a small `class ManagementApiError extends Error { constructor(public readonly status: number, message: string, public readonly code: string, public readonly details?: object) }`) and emits them as-is.

The dashboard's `/api/v1/*` surface keeps its own existing error envelope shape
(`{ error: { code, message } }`) — only the new `/v1/*` group gets this
treatment.
