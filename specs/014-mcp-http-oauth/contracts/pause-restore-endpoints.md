# Contract — `POST /v1/projects/:ref/pause` + `POST /v1/projects/:ref/restore` (US6)

**Purpose**: Async project lifecycle control. Backs upstream MCP `pause_project` + `restore_project` tools.

**Auth**: PAT or OAuth Bearer. RBAC: `instance.pause` for pause, `instance.resume` for restore (both existing actions).

## Pause request

```http
POST /v1/projects/<ref>/pause
Authorization: Bearer <PAT or OAuth JWT>
Content-Type: application/json

{}
```

(No body fields for v1. Upstream Cloud has no body either.)

## Pause response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": "<project ref>",
  "ref": "<project ref>",
  "name": "huntvox",
  "organization_id": "default",
  "region": "self-hosted",
  "created_at": "2026-01-15T10:00:00.000Z",
  "status": "INACTIVE"
}
```

Status `INACTIVE` reflects the immediate DB write; container shutdown happens asynchronously via the lifecycle worker. Caller can poll `get_project` for the same status (no transition expected; `INACTIVE` is stable).

## Restore request

```http
POST /v1/projects/<ref>/restore
Authorization: Bearer <PAT or OAuth JWT>
Content-Type: application/json

{}
```

## Restore response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  ...
  "status": "COMING_UP"
}
```

After the lifecycle worker brings containers back up (~30-60s), the project's status transitions to `ACTIVE_HEALTHY`. The caller polls `get_project` until `ACTIVE_HEALTHY` appears.

## Validation rules

| Rule | Failure |
|---|---|
| Pause: project status MUST be in `{running}` — already paused/provisioning/failed return success idempotently (no state change) | (idempotent — return current state) |
| Restore: project status MUST be in `{paused, stopped}` — already running/provisioning return success idempotently | (idempotent — return current state) |
| Member-role bearer → 403 (both endpoints; admin-only) | 403 `forbidden` |

## Implementation flow

For pause:
1. Auth + RBAC (`instance.pause`).
2. Resolve instance row.
3. If status is `running`: enqueue `lifecycle-pause` worker job (`{ ref }`); UPDATE `supabase_instances SET status='paused' WHERE ref=…`. If status is already `paused`: no-op.
4. Translate status to Cloud enum (Decision 8): `paused → INACTIVE`.
5. Return project JSON with translated status.
6. Emit audit `instance.pause` (existing action value).

For restore:
1. Auth + RBAC (`instance.resume`).
2. Resolve instance row.
3. If status is `paused` or `stopped`: enqueue `lifecycle-resume` worker job; UPDATE `supabase_instances SET status='provisioning' WHERE ref=…`. If already `running` or `provisioning`: no-op.
4. Translate status: `provisioning → COMING_UP`, `running → ACTIVE_HEALTHY`.
5. Return project JSON with translated status.
6. Emit audit `instance.resume`.

## Error responses

```json
{ "message": "Project not found", "code": "not_found", "details": { "ref": "..." } }
```

```json
{ "message": "admin role required", "code": "forbidden" }
```

## Status-enum translation helper

Single helper used by these endpoints + by `GET /v1/projects` + `GET /v1/projects/:ref` (Decision 8):

```ts
// apps/api/src/services/project-status-mapper.ts
const SELFBASE_TO_CLOUD: Record<string, string> = {
  running: 'ACTIVE_HEALTHY',
  paused: 'INACTIVE',
  stopped: 'INACTIVE',
  provisioning: 'COMING_UP',
  creating: 'COMING_UP',
  failed: 'UNKNOWN',
  deleting: 'REMOVED',
};
export function mapSelfbaseStatusToCloud(s: string): string {
  return SELFBASE_TO_CLOUD[s] ?? 'UNKNOWN';
}
```

(Also retrofitted into existing `/v1/projects/*` GET responses as part of this feature so MCP `list_projects` / `get_project` return Cloud-shape statuses.)

## Test obligations

- Pause a running project → 200 + `status: "INACTIVE"`; worker job enqueued; status row updated
- Pause an already-paused project → 200 + `status: "INACTIVE"`; no worker job enqueued (idempotent)
- Restore a paused project → 200 + `status: "COMING_UP"`; worker job enqueued
- Restore an already-running project → 200 + `status: "ACTIVE_HEALTHY"`; idempotent
- Pause unknown ref → 404 `not_found`
- Member-role token → 403 on both endpoints
- Audit row emitted (`instance.pause` / `instance.resume` — existing action values)
- Status-enum translation: every status appears in the response as a Cloud-enum value (verified by snapshot test against `list_projects`)
- Live-VM E2E: pause + wait + restore + assert `ACTIVE_HEALTHY` within 60s
