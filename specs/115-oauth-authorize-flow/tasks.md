---
description: "Task list for feature 115 — Supabase-Style OAuth Authorize Flow"
---

# Tasks: Supabase-Style OAuth Authorize Flow

**Input**: Design documents from `/specs/115-oauth-authorize-flow/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/oauth-authorize-endpoint.md

**Tests**: REQUIRED. OAuth is security-sensitive (Constitution Principle VI mandates unit tests for security-sensitive logic) and the user's standing feedback requires both happy- and sad-path cases. Every endpoint/service ships with tests.

**Organization**: By user story. Stories share two files (`platform-misc.ts`, `oauth-platform-consent.test.ts`); tasks touching the same file are ordered sequentially (no `[P]`) but each story remains independently testable.

## Key facts grounding these tasks (verified against the codebase)

- The three platform endpoints **already exist as stubs** in `apps/api/src/routes/platform-misc.ts`:
  - `GET /platform/oauth/authorizations/:id` (~line 2191) → returns `{}`
  - `POST /platform/organizations/:slug/oauth/authorizations/:id` (~line 3086) → returns `{}`
  - `DELETE /platform/organizations/:slug/oauth/authorizations/:id` (~line 3091) → returns 204
  These are **converted** (not created).
- `authorization_endpoint` = `https://api.<apex>/v1/oauth/authorize` (`discovery.ts:24`); the Studio consent page is at `https://<apex>/dashboard/authorize`. The redirect is therefore **absolute, cross-host**: `https://${SUPASTACK_APEX}/dashboard/authorize?auth_id=<UUID>`.
- `SUPASTACK_APEX` env is available in the api container (used by `auth.ts:77` + `discovery.ts:15`).
- RBAC matrix tiers live in `packages/shared/src/rbac.ts` (`READ_ONLY` / `DEVELOPER_EXTRA` / `ADMIN_EXTRA` / `OWNER_EXTRA`); a regression snapshot in `apps/api/tests/contract/rbac.test.ts` must be regenerated when actions are added.
- `req.user` on `/platform/*` is set by the Bearer preHandler (`auth.ts`); `app.authorize(req, action)` (sync, global role) and `app.authorizeOrg(req, action, orgId)` (async, org role; `orgId === :slug`) are decorated in `plugins/rbac.ts`.
- The Studio consent page (`apps/studio/pages/authorize.tsx`) is upstream and **unchanged** — no frontend work in this feature.

---

## Phase 1: Setup

**Purpose**: Confirm insertion points and preconditions. No code change.

- [X] T001 Review the three existing stub handlers in `apps/api/src/routes/platform-misc.ts` (`GET /platform/oauth/authorizations/:id` ~2191, `POST /platform/organizations/:slug/oauth/authorizations/:id` ~3086, `DELETE …` ~3091) and confirm `process.env.SUPASTACK_APEX` is set in the api container (referenced by `auth.ts:77`). Note: the org-scoped `GET /platform/organizations/:slug/oauth/authorizations/:id` stub (~2182) is **not** used by the consent flow (Studio calls the flat GET) and is left as-is.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: RBAC actions + the Redis auth-session store. Both are used by every user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T002 [P] Add OAuth-consent RBAC actions in `packages/shared/src/rbac.ts`: append `'oauth.consent.read'` and `'oauth.consent.approve'` to the `ACTIONS` array; add `'oauth.consent.read'` to the `READ_ONLY` tier (any authenticated member may read a pending authorization — the `auth_id` is a capability token) and `'oauth.consent.approve'` to the `ADMIN_EXTRA` tier (owner + administrator may grant an MCP client; conservative default for a broad-scope token).
- [X] T003 Regenerate the RBAC matrix inline snapshot in `apps/api/tests/contract/rbac.test.ts` (`pnpm --filter @supastack/api test -- -u rbac.test`); verify the 8 new cells: `oauth.consent.read` = ALLOW for all 4 roles; `oauth.consent.approve` = ALLOW for owner+administrator, DENY for developer+read_only. (depends on T002)
- [X] T004 [P] Create `apps/api/src/services/oauth-auth-sessions-store.ts`: export `interface OAuthAuthSession` (per data-model.md) + `createAuthSession(params)` (generate `randomUUID()` auth_id; `SET oauth:auth_session:<id> <json> EX 600 NX`; stamp `created_at`/`expires_at`; return auth_id), `getAuthSession(id)` (`GET` → JSON.parse | null), `consumeAuthSession(id)` (`GETDEL` → JSON.parse | null). Use a module-local `getRedis()` ioredis singleton mirroring `apps/api/src/routes/oauth/clients-dashboard.ts:29-35`. Key prefix `oauth:auth_session:`.
- [X] T005 [P] Unit test `apps/api/tests/unit/oauth-auth-sessions-store.test.ts` (mock `ioredis`): **happy** — create→get returns the same payload; consume returns the payload then a subsequent get→null; createAuthSession issues `SET … EX 600 NX` (assert args) and a v4 UUID auth_id. **sad** — get on a missing key→null; consume on an already-consumed/missing key→null; malformed JSON→null (no throw). (validates T004)

**Checkpoint**: RBAC + session store ready and unit-green. User stories can begin.

---

## Phase 3: User Story 1 - MCP Client Completes OAuth Authorization (Priority: P1) 🎯 MVP

**Goal**: The full happy path works: open `/v1/oauth/authorize` → 303 to the Studio consent page → approve → callback receives `code`+`state` → exchange for a token.

**Independent Test**: Run the quickstart.md PKCE client: open the authorize URL, confirm redirect to `/dashboard/authorize?auth_id=…`, confirm the consent page shows the client name + scopes, click Authorize, confirm the callback URL carries `code` and `state`, exchange for an access token.

- [X] T006 [US1] Rewrite `apps/api/tests/unit/oauth-authorize.test.ts` for the new GET-only behavior (mock `../../src/services/oauth-auth-sessions-store.js` `createAuthSession`): **happy** — valid params → 303 with `Location` matching `^https://…/dashboard/authorize?auth_id=` and `createAuthSession` called once with the parsed params; **sad** — unknown `client_id`→400 `invalid_client`, `redirect_uri` not in allow-list→400 `invalid_request`, `code_challenge_method=plain`→400 `invalid_request`. DELETE the old `POST /v1/oauth/authorize` describe block, the 200-HTML case, and the `/dashboard/login` redirect case.
- [X] T007 [US1] Rewrite `apps/api/src/routes/oauth/authorize.ts` GET handler: keep `validateParams()`; `getClientById` + `validateRedirectUri` (unchanged 400s); call `createAuthSession({ client_id, client_name: client.clientName, client_website: <metadata.website ?? ''>, client_icon: <metadata.icon ?? null>, client_domain: new URL(redirect_uri).hostname, redirect_uri, state, code_challenge, code_challenge_method, scopes: (scope ?? ALLOWED_SCOPE).split(' ').filter(Boolean) })`; `return reply.redirect(303, \`https://${process.env.SUPASTACK_APEX}/dashboard/authorize?auth_id=${authId}\`)`. **Remove** the `POST` handler, `renderConsentHtml`, `resolveOperator`, `buildAuthorizePath`, the unauthenticated `/dashboard/login` branch, `emitAudit` (moves to platform-misc), and now-unused imports (`verifyGotrueJwt`, `loadMasterKey`, `eq`, `issueCode`). (depends on T004)
- [X] T008 [US1] Convert the GET-details stub in `apps/api/src/routes/platform-misc.ts` (`/platform/oauth/authorizations/:id`, ~2191): `app.authorize(req, 'oauth.consent.read')`; `const s = await getAuthSession(req.params.id)`; if `!s` → 404 `{ error: 'not_found', message: 'Authorization session not found or expired' }`; else return `{ name: s.client_name, website: s.client_website, icon: s.client_icon, domain: s.client_domain, scopes: s.scopes, expires_at: s.expires_at, approved_at: null, approved_organization_slug: null }`. Add `import { getAuthSession, consumeAuthSession } from '../services/oauth-auth-sessions-store.js'` at the top. (depends on T004)
- [X] T009 [US1] Convert the POST-approve stub in `apps/api/src/routes/platform-misc.ts` (`/platform/organizations/:slug/oauth/authorizations/:id`, ~3086) to typed `{ Params:{slug,id}; Querystring:{ skip_browser_redirect?: string } }`: `await app.authorizeOrg(req, 'oauth.consent.approve', req.params.slug)`; `const s = await consumeAuthSession(req.params.id)`; if `!s` → 404; `const { code } = await issueCode({ clientId: s.client_id, userId: req.user!.id, redirectUri: s.redirect_uri, codeChallenge: s.code_challenge, scope: s.scopes.join(' ') })`; build `url = \`${s.redirect_uri}${s.redirect_uri.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}&state=${encodeURIComponent(s.state)}\``; emit `oauth.code.issued` audit (insert into `schema.auditLog`, mirroring the former `emitAudit` in authorize.ts); if `req.query.skip_browser_redirect === 'true'` → `reply.status(201).send({ url })` else `reply.redirect(302, url)`. Add `import { issueCode } from '../services/oauth-codes-store.js'`. (depends on T004, T008 — same file, sequential after T008)
- [X] T010 [P] [US1] Black-box test `apps/api/tests/unit/oauth-platform-consent.test.ts` (mock store + `issueCode` + decorate `authorize`/`authorizeOrg`/`requireAuth`, register the routes; mirror `platform-misc-routes.test.ts` harness): **GET details** happy → 200 with `name`/`scopes`/`expires_at`; sad → 404 when session missing, 401 when unauthenticated. **POST approve** (`?skip_browser_redirect=true`) happy → 201 `{ url }` containing `code=`+`state=` and `oauth.code.issued` audit emitted; without the flag → 302 to the same URL; sad → 404 when the session was already consumed/missing.

**Checkpoint**: MVP — a real MCP PKCE client can authorize end-to-end and exchange a code for a token.

---

## Phase 4: User Story 2 - Auth Session Stored Server-Side (Priority: P2)

**Goal**: Prove the server-side-storage security properties: the consent URL leaks no raw OAuth params, and replayed/expired `auth_id`s are rejected.

**Independent Test**: Approve an `auth_id`, then re-approve it → second call 404. Inspect the authorize redirect → `Location` carries only `auth_id`, no `code_challenge`/`redirect_uri`/`state`. Let a session expire (TTL) → GET details → 404.

- [X] T011 [US2] Add clean-URL assertion to `apps/api/tests/unit/oauth-authorize.test.ts`: the 303 `Location` contains `auth_id=` and does **not** contain `code_challenge`, `redirect_uri`, or `state` (SC-002). (same file as T006 — sequential)
- [X] T012 [US2] Add replay + expiry cases to `apps/api/tests/unit/oauth-platform-consent.test.ts`: approving the same `auth_id` twice → second call 404 (store `consumeAuthSession` returns null on the 2nd); GET details for an expired/missing session → 404. (same file as T010 — sequential)
- [X] T013 [US2] Grep for stale assertions of the old behavior: `rg "oauth/authorize" apps/api/tests packages specs/*/contracts docs` — update/remove any test or pinned `/v1` OpenAPI snapshot asserting the former 200-HTML GET or the `POST /v1/oauth/authorize` consent submit (note: upstream Supabase has no `POST /v1/oauth/authorize`, so removing it moves us **toward** parity — Principle IV is satisfied). Confirm the `/v1` contract test stays green.

**Checkpoint**: Session storage is provably single-use, time-bounded, and leak-free.

---

## Phase 5: User Story 3 - Organization-Scoped Consent + Deny (Priority: P3)

**Goal**: Deny works, consent is org-membership-gated (403 for non-members), and both approve and deny are audited.

**Independent Test**: DELETE an `auth_id` as an org member → 200 `{ id }` + `oauth.consent.denied` audit. Attempt approve/deny as a non-member → 403. (Approve org-scoping + 403 are already provided by `authorizeOrg` in T009; US3 adds the deny endpoint and proves the authz/audit guarantees.)

- [X] T014 [US3] Convert the DELETE-deny stub in `apps/api/src/routes/platform-misc.ts` (`/platform/organizations/:slug/oauth/authorizations/:id`, ~3091): `await app.authorizeOrg(req, 'oauth.consent.approve', req.params.slug)`; `const s = await consumeAuthSession(req.params.id)`; if `!s` → 404; emit `oauth.consent.denied` audit (`schema.auditLog`, payload `{ client_id: s.client_id }`); `return reply.status(200).send({ id: req.params.id })`. (same file — sequential after T009)
- [X] T015 [P] [US3] Test `apps/api/tests/unit/oauth-platform-consent-deny.test.ts`: **happy** — DELETE deny → 200 `{ id }` + `oauth.consent.denied` audit emitted; **sad** — non-member (`authorizeOrg` throws) → 403; already-consumed/missing session → 404.

**Checkpoint**: Deny + org-scoped authorization + audit all proven; all three stories independently green.

---

## Phase 6: Polish & Cross-Cutting

- [X] T016 [P] Write runbook `docs/changes/115-oauth-authorize-flow.md`: the 3-stage flow (authorize 303 → Studio consent → approve/deny), the new service + endpoints, RBAC actions, "deploy = rebuild api only (no migration, no Studio rebuild, no worker change)", rollback (revert api).
- [X] T017 [P] Update the active-feature pointer in `CLAUDE.md` (`<!-- SPECKIT START -->` block) to reflect shipped status once implementation is complete.
- [X] T018 Run `specs/115-oauth-authorize-flow/quickstart.md` end-to-end against supaviser.dev: register a client, do the PKCE dance, browser-authorize → consent → callback, exchange the code for a token; record the result.
- [X] T019 Final gate: `pnpm --filter @supastack/api test` (all oauth + consent + rbac-snapshot green) + lint + typecheck clean.

---

## Dependencies & Execution Order

- **Setup (T001)** → no dependencies.
- **Foundational (T002–T005)** → blocks all user stories. T003 depends on T002. T005 validates T004.
- **US1 (T006–T010)** → depends on Foundational. T007 depends on T004; T008 depends on T004; T009 depends on T008 (same file); T006 is test-first for T007; T010 is independent (own file).
- **US2 (T011–T013)** → depends on US1 (asserts US1's behavior). T011 edits T006's file; T012 edits T010's file → sequential.
- **US3 (T014–T015)** → depends on US1 (reuses the session store + audit pattern). T014 edits platform-misc.ts after T009; T015 is independent (own file).
- **Polish (T016–T019)** → after the desired stories. T018/T019 after all code tasks.

## Parallel Opportunities

- Foundational: T002 (`rbac.ts`), T004 (new service), T005 (new test) run in parallel — three different files.
- US1: T010 (new consent test) runs parallel to the `authorize.ts` work (T006/T007).
- US3: T015 (new deny test) runs parallel to the runbook (T016).
- Polish: T016 + T017 in parallel.

```bash
# Foundational, in parallel:
Task: "Add oauth.consent.* actions in packages/shared/src/rbac.ts"          # T002
Task: "Create apps/api/src/services/oauth-auth-sessions-store.ts"           # T004
Task: "Unit test apps/api/tests/unit/oauth-auth-sessions-store.test.ts"     # T005
```

## Implementation Strategy

1. **Foundational first** (T002–T005) — RBAC + session store, unit-green. Blocks everything.
2. **US1 = MVP** (T006–T010) — wire authorize→consent→approve→callback. **STOP and validate** the full PKCE flow (quickstart) before proceeding.
3. **US2** (T011–T013) — prove the storage security properties + remove legacy code/test cruft.
4. **US3** (T014–T015) — deny endpoint + authz/audit proof.
5. **Polish** (T016–T019) — runbook, live VM verification, full gate.

Deploy after US1+US2+US3: rebuild the `api` container only. No migration, no Studio rebuild, no worker change.
