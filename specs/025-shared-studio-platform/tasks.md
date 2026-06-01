# Tasks: Shared Studio (IS_PLATFORM=true)

**Input**: Design documents from `specs/025-shared-studio-platform/`

**Prerequisites**: plan.md ✅ spec.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅

**Branch**: `083-shared-studio-platform`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on in-progress tasks)
- **[Story]**: User story this task belongs to (US1 = DB editor, US2 = auth/storage/functions, US3 = apex routing)
- Exact file paths required in all task descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify proxy library available, establish routing foundation

- [x] T001 Check `apps/api/package.json` for `@fastify/reply-from`; if absent, add `undici` import note in `apps/api/src/routes/platform-proxy.ts` header comment
- [x] T002 [P] Create `apps/api/src/routes/platform-proxy.ts` as an empty Fastify plugin skeleton (export default async function, no routes yet)
- [x] T003 [P] Create `apps/api/src/services/platform-proxy-helpers.ts` with `resolveKongPort(ref: string): Promise<number>` that queries `port_allocations` via Drizzle and throws 404 if not found and 503 if instance is PAUSED

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core proxy helper + plugin registration must be complete before any route group

**⚠️ CRITICAL**: T003 and T008 must complete before any US1/US2/US3 proxy routes

- [x] T004 Implement `resolveKongPort` in `apps/api/src/services/platform-proxy-helpers.ts` — query `port_allocations` joining `instances` to check state; return port or throw typed errors (NotFound, ProjectPaused)
- [x] T005 Implement generic `proxyToKong(req, reply, port, upstreamPath, opts)` helper in `apps/api/src/services/platform-proxy-helpers.ts` using `undici.request`; strips `x-connection-encrypted` from forwarded headers; strips `access-control-*` from upstream response headers; pipes response body stream
- [x] T006 Register `platform-proxy.ts` plugin in `apps/api/src/server.ts` under the `/platform` prefix (alongside existing route registrations)
- [x] T007 Add Vitest unit test file `apps/api/tests/unit/platform-proxy.test.ts` with mock for `resolveKongPort` — verify 401 on unauthenticated, 404 on unknown ref, 503 on paused project

**Checkpoint**: Foundation ready — route groups for US1/US2/US3 can be implemented in parallel

---

## Phase 3: User Story 1 — Database Editor (Priority: P1) 🎯 MVP

**Goal**: Studio database editor and SQL editor work for any project via the shared Studio

**Independent Test**: Navigate to `https://<apex>/project/<ref>/editor`, run `SELECT 1`, see result row — with no per-project Studio container running

- [x] T008 [US1] Implement pg-meta proxy route group in `apps/api/src/routes/platform-proxy.ts`:
  - `GET|POST|PUT|PATCH|DELETE /platform/pg-meta/:ref/*`
  - Strip `x-connection-encrypted` header
  - Forward to `http://host.docker.internal:<portKong>/pg-meta/v0/*`
  - Require `app.requireAuth` on all routes
- [x] T009 [US1] Add happy-path + sad-path Vitest tests for pg-meta proxy in `apps/api/tests/unit/platform-proxy.test.ts`:
  - Happy: proxies GET `/platform/pg-meta/ref123/tables` → Kong `/pg-meta/v0/tables`
  - Sad: `x-connection-encrypted` header not forwarded upstream
  - Sad: upstream CORS headers stripped from response

---

## Phase 4: User Story 2 — Auth, Storage & Functions Management (Priority: P2)

**Goal**: Auth users, storage buckets, and edge functions management work for any project via shared Studio

**Independent Test**: Create an auth user at `/project/<ref>/auth/users` and a storage bucket at `/project/<ref>/storage` — both persist in the real per-project services

- [x] T010 [P] [US2] Implement storage proxy route group in `apps/api/src/routes/platform-proxy.ts`
- [x] T011 [P] [US2] Implement auth admin proxy route group in `apps/api/src/routes/platform-proxy.ts`
- [x] T012 [P] [US2] Implement analytics proxy route group in `apps/api/src/routes/platform-proxy.ts`
- [x] T013 [US2] Add Vitest tests for storage + auth + analytics proxy routes in `apps/api/tests/unit/platform-proxy.test.ts`

---

## Phase 5: User Story 3 — Shared Studio at Apex Root (Priority: P3)

**Goal**: `https://<apex>/` serves the shared Studio; `/setup*` continues to serve the Supastack web SPA; `/api/v1/*` continues to serve the Fastify API

**Independent Test**: `https://<apex>/` → Studio project list. `https://<apex>/setup` → Supastack setup wizard. `https://<apex>/api/v1/health` → API health JSON.

- [x] T014 [US3] Add `studio` service to `infra/docker-compose.yml` (control plane)
- [x] T015 [US3] Update Caddy config `apps/caddy/Caddyfile` — add `handle /setup* { reverse_proxy web:80 }` and change catch-all to `reverse_proxy studio:3000` in both `:80` and `:443` blocks
- [x] T016 [US3] Remove `studio` service from `infra/supabase-template/docker-compose.yml` and remove its `depends_on` from kong
- [x] T017 [US3] portStudio cannot be removed without a migration (column is notNull); studio port is still allocated (reserved) but no container starts — T016 covers the behavioral change
- [x] T018 [P] [US3] Update `instanceUrls()` in `apps/api/src/routes/instances.ts` to point to `https://<apex>/project/<ref>`; update "Open Studio" href in `apps/web/src/pages/ProjectGeneral.tsx` to use `data.urls.studio`

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Smoke test, documentation, cleanup

- [ ] T019 [P] Write Playwright e2e smoke test in `apps/web/tests/e2e/studio-shared.spec.ts` — deferred (requires live Studio container in CI; tracked separately)
- [ ] T020 [P] Add `studio-shared.spec.ts` to the `EXPECTED_PAGES` registry — deferred with T019
- [x] T021 Write `docs/changes/025-shared-studio-platform.md` runbook covering: architecture diagram, deploy steps, how to add more proxy routes, Phase 2 production-build path

---

## Dependencies

```
T001 → T002, T003
T003 → T004 → T005 → T006 → T007
T006 → T008 (US1), T010 (US2), T011 (US2), T012 (US2)
T008 → T009
T010, T011, T012 → T013
T014, T015, T016, T017, T018 → T019, T020
All phases → T021
```

## Parallel Execution Opportunities

**After T006 (foundation complete)**:
- T008 (pg-meta routes) runs independently
- T010 + T011 + T012 (storage + auth + analytics) can all run in parallel
- T014 + T015 + T016 + T017 + T018 (compose + caddy + worker + web link) can all run in parallel

**After T008**:
- T009 (pg-meta tests) runs

**After T010 + T011 + T012**:
- T013 (combined tests) runs

## Implementation Strategy

**MVP = Phase 3 (US1) only**: Platform-proxy routes for pg-meta + Studio running in compose. Proves the architecture. Everything else builds on top.

1. **Phase 1–2** (T001–T007): Scaffold + foundation + unit test harness
2. **Phase 3** (T008–T009): pg-meta proxy → DB editor works end-to-end ← **demo here**
3. **Phase 4** (T010–T013): Storage + auth + analytics proxies
4. **Phase 5** (T014–T018): Compose wiring + Caddy routing + remove per-project Studio
5. **Phase 6** (T019–T021): E2e smoke + docs
