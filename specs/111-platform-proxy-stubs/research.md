# Research: Platform Proxy Stub Conversions (Feature 111)

## Code Audit Findings

### Decision: Actual stub count is 6, not 17
- **Rationale**: The spec estimated 17 based on the comparison doc before feature 109 shipped. Feature 109 (commit `651457e`) already converted 17 platform stubs (functions/secrets delegation, network-bans, network-restrictions, ssl-enforcement, audit/activity, downloadable-backups, lint queries, status endpoints). After code audit, only 6 distinct URL+method combinations remain as genuine stubs or broken delegations.
- **Alternatives considered**: Accept the inflated count, count platform-only vs v1-only separately.

**The 6 real changes:**

| Route | Current state | Fix |
|-------|--------------|-----|
| `GET /platform/projects/:ref/api/rest` | Hardcoded response (`maxRows: 1000`, `schema: 'public'`) | Delegate to `GET /v1/projects/:ref/postgrest` |
| `GET /platform/projects/:ref/postgres-config` | Static defaults | Delegate to `GET /v1/projects/:ref/config/database/postgres` |
| `PATCH /platform/projects/:ref/postgres-config` | Echoes body | Delegate to `PATCH /v1/projects/:ref/config/database/postgres` |
| `DELETE /platform/projects/:ref/functions/secrets` | Missing (no route registered) | Add, delegate to `DELETE /v1/projects/:ref/secrets` |
| `DELETE /v1/projects/:ref/api-keys/:id` | 501 not_implemented | 404 not_found (self-hosted has no custom api key store) |
| `PATCH /v1/projects/:ref/api-keys/:id` | 501 not_implemented | 404 not_found (self-hosted has no custom api key store) |

---

### Decision: `GET /platform/projects/:ref/api/rest` → `GET /v1/projects/:ref/postgrest`
- **Rationale**: The v1 route `GET /v1/projects/:ref/postgrest` (in `management/postgrest-config.ts`) is real and backed by the runtime-config-store. The platform stub returns hardcoded values (`maxRows: 1000`, `schema: 'public'`). Studio's Settings → API page calls `api/rest` and gets wrong default values instead of the operator-configured ones.
- **Delegation target**: `GET /v1/projects/:ref/postgrest` (registered in `postgrest-config.ts`, prefix `/v1` → full path `/v1/projects/:ref/postgrest`).
- **Note**: The existing `GET /platform/projects/:ref/config/postgrest` delegation (line 849) uses `/v1/projects/:ref/config/postgrest` which differs from the actual route path. This feature's delegation uses the correct path.

### Decision: `GET/PATCH /platform/projects/:ref/postgres-config` → `GET/PATCH /v1/projects/:ref/config/database/postgres`
- **Rationale**: `management/postgres-config.ts` is fully real, backed by `postgres-config-store`. The platform stubs return static/echoed values. Studio's Database → Configuration page uses these platform routes.
- **Delegation target**: `GET /v1/projects/:ref/config/database/postgres` and `PATCH /v1/projects/:ref/config/database/postgres`.

### Decision: `DELETE /platform/projects/:ref/functions/secrets` → `DELETE /v1/projects/:ref/secrets`
- **Rationale**: `GET` and `POST` for `/platform/projects/:ref/functions/secrets` were fixed in feature 109, but `DELETE` was omitted. Studio's secrets page has a delete button that calls this route, which currently returns 404 (no route registered = Fastify default 404).
- **Alternatives considered**: Leave missing (404 is better than 501); rejected because DELETE should work.

### Decision: `DELETE/PATCH /v1/projects/:ref/api-keys/:id` → 404 not_found
- **Rationale**: Supastack self-hosted has no custom API key store. The current 501 `not_implemented` is inaccurate — the endpoint exists (it's part of the registered route), it just has no keys to act on. 404 is the correct REST response when there is no record with that id. Since there are never custom API key records on self-hosted, every request legitimately returns 404.
- **Why not stay 501**: The 501 implies the feature isn't supported at all. 404 signals the endpoint works, the specific key wasn't found — which is a cleaner failure mode for clients that create custom keys via Cloud but test on self-hosted.
- **Alternatives considered**: Full custom API key CRUD store — out of scope, no upstream schema for it in Supastack. Keep 501 — acceptable but misleading.

---

## Delegation Pattern Reference (Tier 3b)

The `app.inject` pattern is already established in `platform-misc.ts`:
```typescript
app.requireAuth(req);
const resp = await app.inject({
  method: 'GET',
  url: `/v1/projects/${req.params.ref}/some-route`,
  headers: fwdHeaders(req),
});
return reply.status(resp.statusCode).send(resp.json<unknown>());
```

`fwdHeaders(req)` is defined at line 712 of `platform-misc.ts` — strips `content-length` to avoid mismatch on forwarded payloads.

For body-forwarding (PATCH/DELETE):
```typescript
const resp = await app.inject({
  method: 'PATCH',
  url: `/v1/projects/${req.params.ref}/some-route`,
  headers: fwdHeaders(req),
  payload: JSON.stringify(req.body),
});
```

---

## FR Coverage Reconciliation

| FR | Route | Status after audit |
|----|-------|-------------------|
| FR-001 | `POST /v1/projects/:ref/functions` | ALREADY REAL (eszip create, `functions.ts:92`) — no change needed |
| FR-002 | `PATCH /v1/projects/:ref/functions/:slug` | ALREADY REAL + delegated from platform (`platform-misc.ts:4426`) — no change needed |
| FR-003 | `GET /platform/projects/:ref/api/rest` | FIX needed |
| FR-004 | `GET /platform/projects/:ref/postgres-config` | FIX needed |
| FR-005 | `PATCH /platform/projects/:ref/postgres-config` | FIX needed |
| FR-006 | `DELETE /v1/projects/:ref/api-keys/:id` | FIX (501→404) |
| FR-007 | `PATCH /v1/projects/:ref/api-keys/:id` | FIX (501→404) |
| FR-008 | `DELETE /platform/projects/:ref/functions/secrets` | ADD (missing route) |
| FR-009 | Authorization header forwarding | Satisfied by `fwdHeaders(req)` |
| FR-010 | 401 for missing/invalid token | Satisfied by `app.requireAuth(req)` |
| FR-011 | 404 for unknown project | Satisfied by v1 delegation target |
| FR-012 | Unit tests | NEW test file |
