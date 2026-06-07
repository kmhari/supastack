# Implementation Plan: Platform Proxy Stub Conversions (111)

**Branch**: `111-platform-proxy-stubs` | **Date**: 2026-06-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/111-platform-proxy-stubs/spec.md`

## Summary

Fix 6 remaining platform stubs (3 hardcoded-response handlers, 1 missing route, 2 v1 501s) by applying the Tier 3b `app.inject` delegation pattern from feature 109. The v1 delegation targets (`/v1/projects/:ref/postgrest`, `/v1/projects/:ref/config/database/postgres`, `/v1/projects/:ref/secrets`) already exist and work. The two `api-keys/:id` v1 stubs become 404-by-design (no custom api key store on self-hosted).

## Technical Context

**Language/Version**: TypeScript, Node 20, Fastify 4

**Primary Dependencies**: Fastify `app.inject`, existing management route handlers (postgrest-config.ts, postgres-config.ts, api-keys.ts, platform-misc.ts)

**Storage**: N/A — no new tables or migrations; delegates to existing handlers that use the runtime-config-store and postgres-config-store

**Testing**: Vitest, same mock pattern as `platform-stub-conversions.test.ts` (feature 109)

**Target Platform**: Node server in the `api` container

**Project Type**: Route handler additions/fixes within a Fastify server

**Performance Goals**: Sub-100ms per delegation (in-process `app.inject`, no network hop)

**Constraints**: No new migrations, no RBAC matrix changes, no `/v1/*` shape changes

**Scale/Scope**: 2 files modified, 1 new test file, ≤6 handler changes

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I. Idempotent schema | No migrations required | PASS |
| II. Secrets encrypted | No secret storage changes | PASS |
| III. Authorize every action | Platform stubs use `app.requireAuth(req)`; delegation inherits v1 auth; api-keys 404 already gated | PASS |
| IV. Supabase compat | No `/v1/*` response shape changes (501→404 for api-keys is not a contract regression since 501 was a placeholder) | PASS |
| V. Worker owns per-instance state | No worker involvement | PASS |
| VI. Spec-driven delivery | Spec + research + plan + tasks + implement ✓ | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/111-platform-proxy-stubs/
├── plan.md              # This file
├── research.md          # Phase 0 output — stub audit + delegation decisions
├── quickstart.md        # Phase 1 output — test scenarios
├── contracts/
│   └── api-rest.md      # Response shape for GET /platform/.../api/rest
└── tasks.md             # Phase 2 output (/speckit-tasks command)
```

### Source Code

```text
apps/api/src/routes/
├── platform-misc.ts         # Fix lines 886-900 (postgres-config), 966-983 (api/rest),
│                            # add DELETE /platform/.../functions/secrets after line 3760
└── management/
    └── api-keys.ts          # Replace 501 handlers with 404 for DELETE + PATCH /:id

apps/api/tests/unit/
└── platform-proxy-stubs.test.ts   # New: happy + sad path tests for all 6 changes
```

## Phase 1: Platform Handler Fixes (platform-misc.ts)

### Change 1 — `GET /platform/projects/:ref/api/rest` (line 966)

Replace the hardcoded handler with delegation to `GET /v1/projects/:ref/postgrest`:

```typescript
app.get<RefParams>('/platform/projects/:ref/api/rest', async (req, reply) => {
  app.requireAuth(req);
  const resp = await app.inject({
    method: 'GET',
    url: `/v1/projects/${req.params.ref}/postgrest`,
    headers: fwdHeaders(req),
  });
  return reply.status(resp.statusCode).send(resp.json<unknown>());
});
```

**Why this shape**: Verbatim delegation — the v1 response already has `db_schema`, `max_rows`, `db_pool` fields.

### Change 2 — `GET /platform/projects/:ref/postgres-config` (line 886)

Replace static defaults with delegation to `GET /v1/projects/:ref/config/database/postgres`:

```typescript
app.get<RefParams>('/platform/projects/:ref/postgres-config', async (req, reply) => {
  app.requireAuth(req);
  const resp = await app.inject({
    method: 'GET',
    url: `/v1/projects/${req.params.ref}/config/database/postgres`,
    headers: fwdHeaders(req),
  });
  return reply.status(resp.statusCode).send(resp.json<unknown>());
});
```

### Change 3 — `PATCH /platform/projects/:ref/postgres-config` (line 897)

Replace body-echo with delegation to `PATCH /v1/projects/:ref/config/database/postgres`:

```typescript
app.patch<RefParams>('/platform/projects/:ref/postgres-config', async (req, reply) => {
  app.requireAuth(req);
  const resp = await app.inject({
    method: 'PATCH',
    url: `/v1/projects/${req.params.ref}/config/database/postgres`,
    headers: fwdHeaders(req),
    payload: JSON.stringify(req.body),
  });
  return reply.status(resp.statusCode).send(resp.json<unknown>());
});
```

### Change 4 — `DELETE /platform/projects/:ref/functions/secrets` (add after line 3760)

Add missing route that delegates to `DELETE /v1/projects/:ref/secrets`:

```typescript
app.delete<RefParams>('/platform/projects/:ref/functions/secrets', async (req, reply) => {
  app.requireAuth(req);
  const resp = await app.inject({
    method: 'DELETE',
    url: `/v1/projects/${req.params.ref}/secrets`,
    headers: fwdHeaders(req),
    payload: JSON.stringify(req.body),
  });
  return reply.status(resp.statusCode).send(resp.json<unknown>());
});
```

## Phase 2: Management API Stubs (api-keys.ts)

### Change 5 — `DELETE /v1/projects/:ref/api-keys/:id` (line 33)

Replace 501 with 404:

```typescript
app.delete<{ Params: { ref: string; id: string } }>(
  '/projects/:ref/api-keys/:id',
  async (req) => {
    app.requireAuth(req);
    const user = app.requireAuth(req);
    const row = await getProjectByRef(user.id, req.params.ref);
    if (!row) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
    throw new ManagementApiError(404, 'API key not found', 'not_found', { id: req.params.id });
  },
);
```

### Change 6 — `PATCH /v1/projects/:ref/api-keys/:id` (line 44)

Replace 501 with 404:

```typescript
app.patch<{ Params: { ref: string; id: string } }>(
  '/projects/:ref/api-keys/:id',
  async (req) => {
    const user = app.requireAuth(req);
    const row = await getProjectByRef(user.id, req.params.ref);
    if (!row) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
    throw new ManagementApiError(404, 'API key not found', 'not_found', { id: req.params.id });
  },
);
```

**Design note**: 404 is correct REST semantics — the endpoint is registered, the auth check runs, but there are no custom API key records in self-hosted. A client doing DELETE on a non-existent key should get 404, not 501.

## Phase 3: Tests

New test file `apps/api/tests/unit/platform-proxy-stubs.test.ts` using the same `vi.hoisted()` mock pattern as `platform-stub-conversions.test.ts`.

**Test inventory:**

| # | Endpoint | Case |
|---|----------|------|
| 1 | GET api/rest | 200 returns postgrest v1 response verbatim |
| 2 | GET api/rest | 401 unauthenticated |
| 3 | GET api/rest | 404 propagated from v1 |
| 4 | GET postgres-config | 200 returns real config values |
| 5 | GET postgres-config | 401 unauthenticated |
| 6 | PATCH postgres-config | 200 returns updated config |
| 7 | PATCH postgres-config | 401 unauthenticated |
| 8 | DELETE functions/secrets | 200 delegates to v1 secrets |
| 9 | DELETE functions/secrets | 401 unauthenticated |
| 10 | DELETE v1 api-keys/:id | 404 (no custom keys in self-hosted) |
| 11 | DELETE v1 api-keys/:id | 401 unauthenticated |
| 12 | DELETE v1 api-keys/:id | 404 project not found |
| 13 | PATCH v1 api-keys/:id | 404 (no custom keys in self-hosted) |
| 14 | PATCH v1 api-keys/:id | 401 unauthenticated |

Total: 14 new tests.

## Complexity Tracking

No constitution violations — no exceptions needed.
