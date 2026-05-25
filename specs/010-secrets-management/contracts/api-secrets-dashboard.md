# Contract — `/api/v1/projects/<ref>/secrets` + `/api/v1/projects/<ref>/vault/enable`

Dashboard-facing endpoints. **Session-cookie auth** (not PAT). RBAC via session user's role.

---

## GET `/api/v1/projects/<ref>/secrets`

Same response shape as the `/v1/*` GET (see `api-secrets-v1.md`). Implementation delegates to the shared `secretStore.list(ref)` service function.

RBAC: `instance.secrets.read`.

---

## POST `/api/v1/projects/<ref>/secrets`

Same request/response shape as `/v1/*` POST. Atomic batch.

RBAC: `instance.secrets.write`. Non-admin sessions return 403; web client hides Save button preemptively.

---

## DELETE `/api/v1/projects/<ref>/secrets`

Same as `/v1/*` DELETE.

RBAC: `instance.secrets.write`.

---

## POST `/api/v1/projects/<ref>/vault/enable`

Manual re-trigger of the vault enablement worker job. Used by the dashboard "Enable vault" button (FR-002 second clause) — typically after a backup restore.

**Request**: empty body.

**202 Accepted**
```json
{ "jobId": "vault-enable:<ref>:<timestamp>", "queued": true }
```

If a vault-enable job for this ref is already in flight, return the existing jobId with `"queued": false` (idempotent — operator clicking the button twice doesn't double-enqueue).

**4xx**:
- `401` — no session
- `403` — session role lacks `instance.vault.enable`
- `404` — ref unknown
- `409` — ref is in a paused state where backfill cannot run; client shows "Resume project first"

Audit: emit `instance.vault.enabled` (source: `dashboard-button`) on the job's success — not on enqueue.

---

## Contract test obligations

- Session vs PAT auth boundary: posting to `/api/v1/...` with a PAT MUST return 401; posting to `/v1/...` with a session cookie alone (no PAT) MUST return 401. (No accidental cross-mount auth.)
- RBAC denial: non-admin session → 403 with `{ "code": "forbidden", "required": "instance.secrets.write" }`.
- Vault-enable idempotency: two rapid POSTs return the same `jobId`; only one BullMQ job is enqueued (verified via queue introspection in test).
