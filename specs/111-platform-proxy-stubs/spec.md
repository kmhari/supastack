# Feature Specification: Platform Proxy Stub Conversions

**Feature Branch**: `111-platform-proxy-stubs`

**Created**: 2026-06-07

**Status**: Draft

**Input**: Convert the remaining 17 proxyable platform stubs to real implementations by delegating to existing `/v1` Management API endpoints (Tier 3b delegation pattern from feature 109).

## Context

After feature 109, 251 platform stubs remain. A subset of these are "proxyable": each stub has a corresponding `/v1` Management API endpoint that already works (or that can be made real with a small implementation). The fix is the same `app.inject` delegation pattern used in feature 109 for network-bans, ssl-enforcement, etc. — the platform handler forwards the request to the `/v1` route and returns the response verbatim.

Some of these also require the `/v1` route itself to be elevated from a 501 stub to a real implementation first; those are bundled together.

## User Scenarios & Testing

### User Story 1 — Functions Deployment & Management (Priority: P1)

When a developer uses Studio's Edge Functions page, they can deploy new functions, update function metadata (name, verify_jwt), and the function deploy button calls `POST /v1/projects/:ref/functions`. Currently these v1 routes return 501. Once real, Studio function deployment works end-to-end without the CLI.

**Why this priority**: Functions deployment via Studio dashboard is a core workflow; the `POST /v1/projects/:ref/functions` and `PATCH /v1/projects/:ref/functions/:slug` stubs are the most user-visible broken endpoints.

**Acceptance criteria**:
- `POST /v1/projects/:ref/functions` deploys a function (delegates to existing `POST /projects/:ref/functions/deploy`)
- `PATCH /v1/projects/:ref/functions/:slug` updates function metadata (delegates to existing PATCH handler in functions.ts)
- `DELETE /platform/projects/:ref/functions/secrets` deletes secrets (delegates to `DELETE /v1/projects/:ref/secrets`)
- Platform function endpoints that already exist continue to work
- 401 for unauthenticated; 404 for missing project

---

### User Story 2 — PostgREST / API Config via both Platform paths (Priority: P1)

Studio hits `/platform/projects/:ref/api/rest` for the REST API configuration page. This is a second path to the same data as `/platform/projects/:ref/config/postgrest` (which is already real), but it's still a stub. Fixing it makes the Settings → API page load correctly.

**Why this priority**: The Settings → API page is frequently used; the stub causes it to show default placeholders instead of actual PostgREST config.

**Acceptance criteria**:
- `GET /platform/projects/:ref/api/rest` returns the real PostgREST config by delegating to `GET /v1/projects/:ref/postgrest`
- Returns the actual `db_schema`, `max_rows`, `db_pool` values
- 401 for unauthenticated; 404 for missing project

---

### User Story 3 — Postgres Tuning Config (Priority: P2)

Studio's Database → Configuration page calls `GET /platform/projects/:ref/postgres-config` and `PATCH /platform/projects/:ref/postgres-config`. Currently these return static defaults / echo the body. Making them delegate to the real `/v1/projects/:ref/config/database/postgres` route (which reads/writes actual Postgres GUC values via feature 009's postgres-config-store) means changes take effect.

**Why this priority**: Postgres tuning is a power-user feature that already works in the CLI; it should also work in Studio.

**Acceptance criteria**:
- `GET /platform/projects/:ref/postgres-config` returns real GUC values from the postgres-config-store
- `PATCH /platform/projects/:ref/postgres-config` persists changes and returns the updated config
- 401 for unauthenticated; 404 for missing project

---

### User Story 4 — API Keys Management (Priority: P2)

Studio's API Keys settings page (Settings → API → Service Keys) may call `DELETE /v1/projects/:ref/api-keys/:id` and `PATCH /v1/projects/:ref/api-keys/:id` to manage custom API keys. These currently return 501. Making them real allows key rotation and deletion.

**Why this priority**: API key management is table-stakes for any project settings page; 501 errors are jarring.

**Acceptance criteria**:
- `DELETE /v1/projects/:ref/api-keys/:id` deletes the named API key
- `PATCH /v1/projects/:ref/api-keys/:id` updates key name or description
- Returns 404 for unknown key; 401 for unauthenticated

---

### User Story 5 — Remaining Platform→v1 Delegations (Priority: P3)

Any remaining platform stubs that can immediately delegate to an already-implemented v1 route with no new logic required (e.g., `DELETE /platform/projects/:ref/functions/secrets` → `DELETE /v1/projects/:ref/secrets`; additional function body/metadata stubs).

**Why this priority**: Lower-impact but zero-effort wins; same pattern, improves overall coverage count.

**Acceptance criteria**:
- Each delegated endpoint returns the upstream v1 response verbatim
- No new v1 logic required for these — pure forwarding

---

## Functional Requirements

- **FR-001**: `POST /v1/projects/:ref/functions` must deploy a function by forwarding to the internal deploy handler; return the function record.
- **FR-002**: `PATCH /v1/projects/:ref/functions/:slug` must update function metadata (name, verify_jwt, entrypoint_path, import_map_path); return updated record.
- **FR-003**: `GET /platform/projects/:ref/api/rest` must delegate to `GET /v1/projects/:ref/postgrest` and return verbatim response.
- **FR-004**: `GET /platform/projects/:ref/postgres-config` must delegate to `GET /v1/projects/:ref/config/database/postgres`.
- **FR-005**: `PATCH /platform/projects/:ref/postgres-config` must delegate to `PATCH/PUT /v1/projects/:ref/config/database/postgres`.
- **FR-006**: `DELETE /v1/projects/:ref/api-keys/:id` must delete the specified API key; 404 if not found.
- **FR-007**: `PATCH /v1/projects/:ref/api-keys/:id` must update the specified API key; 404 if not found.
- **FR-008**: `DELETE /platform/projects/:ref/functions/secrets` must delegate to `DELETE /v1/projects/:ref/secrets`.
- **FR-009**: All delegation endpoints must forward the `authorization` header and return the upstream HTTP status code + body verbatim.
- **FR-010**: All endpoints must require authentication; return 401 for missing/invalid token.
- **FR-011**: All project-scoped endpoints must return 404 for an unknown project ref.
- **FR-012**: Unit tests must cover happy path and sad path (401, 404, delegation error propagation) for each new endpoint.

## Success Criteria

- All 17 previously-stubbed endpoints return real data instead of empty defaults or 501 errors.
- Studio functions deployment page, REST API config page, and Database configuration page work end-to-end without CLI.
- All new tests pass; existing 704+ tests remain green.
- No regressions in any previously-working endpoint.
- Coverage: comparison doc updated — at least 17 additional ✅ rows.

## Scope

**In scope:**
- Converting identified platform stubs to `app.inject` delegation handlers
- Implementing or fixing v1 management routes that are prerequisite delegations targets (functions deploy/update, api-keys delete/patch)
- Unit tests for all new handlers

**Out of scope:**
- Any platform stub that requires new DB schema, new worker jobs, or billing logic
- Mock-only stubs (those marked as `mock` in comparison doc — cloud-only features)
- Replication, PrivateLink, disk management, log-drain stubs (need custom logic / new infrastructure)

## Dependencies & Assumptions

- Feature 109 complete (Tier 3b delegation pattern established; `fwdHeaders`, `app.inject` pattern available)
- `apps/api/src/routes/management/functions.ts` has working deploy and slug-update handlers
- `apps/api/src/routes/management/postgres-config.ts` has working GET/PUT handlers
- `apps/api/src/routes/management/api-keys.ts` has GET handler; DELETE/PATCH need implementation
- Exact list of 17 endpoints will be enumerated during planning via code audit of platform-misc.ts stubs cross-referenced with management/*.ts routes
