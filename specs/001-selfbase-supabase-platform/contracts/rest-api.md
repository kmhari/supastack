# Contract — Public REST API

All endpoints under `/api/v1/`. Browser users authenticate via session cookie; programmatic clients via `Authorization: Bearer <token>`. Errors follow a uniform shape:

```json
{ "error": { "code": "string", "message": "human readable", "details": { } } }
```

Common error codes: `400 invalid_input`, `401 unauthenticated`, `403 forbidden`, `404 not_found`, `409 conflict`, `410 gone`, `429 rate_limited`, `500 internal`.

| Role gate | Notation |
|---|---|
| `[open]` | unauthenticated allowed (setup, login) |
| `[any]` | any authenticated user |
| `[admin]` | admin only |
| `[member]` | any member-or-above (member or admin) |

---

## Setup & auth

### `GET /api/v1/setup/status` `[open]`

Returns whether first-time setup is still possible.

**200** `{ "open": true }` or `{ "open": false }`.

### `POST /api/v1/setup` `[open]`

First-time-only. Refused if `setup_state.completed_at IS NOT NULL`.

**Request** `application/json`:

```json
{
  "email": "you@example.com",
  "password": "min-12-chars",
  "orgName": "Selfbase",
  "apexDomain": "selfbase.example.com"   // optional
}
```

**Responses**:
- **201** `{ "userId": "uuid", "orgId": "uuid", "apiToken": "raw-token-shown-once" }`
- **410** `setup_complete` — already done.

Side effects: creates user (admin), org (singleton), `setup_state` row; if `apexDomain` provided, registers it and triggers Caddy reload.

### `POST /api/v1/auth/login` `[open]`

**Request**: `{ "email", "password" }`.

**Responses**:
- **200** `{ "userId", "email", "role" }`; sets session cookie.
- **401** `invalid_credentials` — no information leak about whether user exists.

### `POST /api/v1/auth/logout` `[any]`

**Response**: **204**; destroys session.

### `GET /api/v1/auth/me` `[any]`

**Response**: **200** `{ "userId", "email", "role" }`.

### Token management

- `POST /api/v1/auth/tokens` `[any]` — body `{ "label" }`; response `{ "id", "token": "raw-once", "label" }`.
- `GET /api/v1/auth/tokens` `[any]` — list current user's tokens (no raw token returned).
- `DELETE /api/v1/auth/tokens/:id` `[any]` — revoke own token.

---

## Org & members

### `GET /api/v1/org` `[any]`

**200** `{ "id", "name", "apexDomain", "backupStoreKind" }`.

### `PATCH /api/v1/org` `[admin]`

Body (any subset): `{ "name?", "apexDomain?" }`. Returns updated org. Apex changes trigger Caddy reload.

### `PUT /api/v1/org/backup-store` `[admin]`

Body (oneOf):

```json
{ "kind": "local" }
```

```json
{
  "kind": "s3",
  "endpoint": "https://...",        // optional; omitted = AWS S3
  "bucket": "selfbase-backups",
  "region": "us-east-1",
  "accessKeyId": "AKIA...",
  "secretAccessKey": "..."
}
```

Returns the new store kind (no secrets echoed). Secrets stored encrypted.

### Members

- `GET /api/v1/members` `[any]` — list `[{ userId, email, role, createdAt }]`.
- `POST /api/v1/members/invites` `[admin]` — body `{ "email", "role": "admin"|"member" }`; response `{ "id", "email", "role", "link": "https://<apex>/accept-invite?token=<raw>", "expiresAt" }` (raw token shown once).
- `GET /api/v1/members/invites` `[admin]` — list open invites.
- `DELETE /api/v1/members/invites/:id` `[admin]` — revoke.
- `POST /api/v1/members/invites/accept` `[open]` — body `{ "token", "password" }` (sets initial password on first acceptance). Creates the user and `org_members` row.
- `DELETE /api/v1/members/:userId` `[admin]` — remove a member; cascades to sessions and tokens.

---

## Instances

### `GET /api/v1/instances` `[any]`

Query: `?status=running|paused|failed` (optional).

**200** `[{ ref, name, status, supabaseVersion, ports: { kong, studio, postgres, pooler, analytics }, urls: { kong, studio }, createdAt, updatedAt, backupAutoEnabled, backupRetain, lastBackupAt }]`.

Note: `ports.postgres`, `ports.pooler`, `ports.analytics` are returned only for `[admin]`; members see only externally-meaningful fields.

### `POST /api/v1/instances` `[admin]`

**Request**:

```json
{
  "name": "huntvox prod",
  "supabaseVersion": "2026.05.01",     // optional; defaults to platform-pinned
  "smtp": {                            // optional
    "host": "smtp.resend.com",
    "port": 587,
    "user": "resend",
    "password": "re_..."
  },
  "enableSignup": true,                 // optional, default true
  "jwtExpirySec": 3600,                 // optional, default 3600
  "backupAutoEnabled": true,            // optional, default true
  "backupRetain": 7                     // optional, default 7
}
```

**202** `{ "ref", "name", "status": "provisioning" }`. Subsequent polls via `GET /api/v1/instances/:ref` report status transitions.

### `GET /api/v1/instances/:ref` `[any]`

**200** full instance detail (same shape as list element). Members do not get internal-only port fields.

### `PATCH /api/v1/instances/:ref` `[admin]`

Body (any subset): `{ "name?", "backupAutoEnabled?", "backupRetain?" }`. Returns updated row.

### `POST /api/v1/instances/:ref/credentials/reveal` `[any]`

Returns the per-instance secrets after a re-auth challenge (requires the user's password OR a freshly issued WebAuthn assertion in v1.5+). In v1: re-auth via password.

**Request**: `{ "password" }`.

**Responses**:
- **200** `{ "anonKey", "serviceRoleKey", "jwtSecret", "postgresPassword", "dashboardPassword", "connectionStrings": { "rest", "auth", "storage", "directDb" } }`.
- **401** `reauth_required`.

Side effects: writes `secret.reveal` audit entry attributed to the acting user.

### Lifecycle

- `POST /api/v1/instances/:ref/pause` `[admin]` → 202, enqueues lifecycle job.
- `POST /api/v1/instances/:ref/resume` `[admin]` → 202.
- `POST /api/v1/instances/:ref/restart` `[admin]` → 202.
- `POST /api/v1/instances/:ref/upgrade` `[admin]` — body `{ "supabaseVersion", "backupFirst": true }` → 202.
- `DELETE /api/v1/instances/:ref` `[admin]` → 202, enqueues delete job; row remains visible with `status='deleting'` until cleanup completes.

---

## Backups

### `GET /api/v1/instances/:ref/backups` `[any]`

**200** `[{ id, kind: 'manual'|'auto', status, storeKind, sizeBytes?, startedAt, completedAt?, downloadUrl? }]`. `downloadUrl` is only present for completed local-store backups (signed short-lived URL).

### `POST /api/v1/instances/:ref/backups` `[admin]`

Trigger an on-demand backup. **202** `{ "id", "status": "running" }`.

### `GET /api/v1/instances/:ref/backups/:id/download` `[any]`

Streams the artifact for local-store backups (`Content-Disposition: attachment`). For S3-store backups, **307** redirect to a signed S3 URL.

---

## Apex domain

Subsumed under `PATCH /api/v1/org` (the `apexDomain` field) and the `PUT /api/v1/org/backup-store` shapes; no dedicated `domains` resource in v1 (since there's exactly one apex per org).

---

## Audit log

### `GET /api/v1/audit` `[admin]`

Query: `?action=...&actor=...&since=ISO&until=ISO&limit=100&cursor=...`.

**200** `{ "entries": [{ id, actorUserId, actorEmail, action, targetKind, targetId, payload, createdAt }], "nextCursor": "..." }`.

---

## Health & liveness

- `GET /api/v1/health` `[open]` — **200** `{ "status": "ok" }`; **503** if a critical dependency (DB, Redis, Caddy admin) is unreachable.
