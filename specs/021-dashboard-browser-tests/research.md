# Phase 0 Research: Dashboard Browser-Level E2E Tests

**Feature**: 021-dashboard-browser-tests | **Date**: 2026-05-28

Resolves the 5 open questions identified in `plan.md`.

---

## R-001: Playwright vs Cypress vs Puppeteer

**Decision**: Playwright (`@playwright/test`).

**Rationale**:
- Repo already has placeholder spec files written in Playwright idiom (`apps/web/tests/e2e/*.spec.ts`); no new convention to introduce.
- First-class TypeScript support; types ship with the package, no separate `@types/*` install.
- Built-in trace viewer (`trace: 'retain-on-failure'`) makes CI failure forensics dramatically easier than Cypress's screenshot-and-video-only approach.
- Parallel-by-default test execution (we disable it for state-sharing simplicity in v1, but the option exists for future scale).
- One install command for all browsers (`npx playwright install --with-deps chromium`); CI cache works cleanly.
- Active maintenance + frequent releases (Microsoft-backed). Cypress's open-source roadmap has cooled.

**Alternatives considered**:
- **Cypress**: more familiar in some circles; better "in-browser test runner" UX. But the architecture (tests run inside the browser, not driving it) makes some cross-origin and multi-tab cases (US2's deep-link, US4's multi-context invite flow) awkward.
- **Puppeteer**: lower-level; we'd have to build a test runner on top. Pointless when Playwright wraps it well.
- **WebdriverIO**: powerful, but the config surface is larger and the ergonomics worse than Playwright for our use case.

---

## R-002: Disposable CI stack — docker-in-docker vs pnpm dev

**Decision**: Hybrid — `docker compose up -d` for `db` + `redis` only; `pnpm dev` for the api and web layers running as Node processes on the runner.

**Rationale**:
- `pnpm dev` already starts both api (`apps/api` via tsx) and web (Vite dev server) — well-trodden path.
- Cold-start time: ~10s for postgres + redis containers + ~5s for the Node servers = ~15s total. Well under the 5-min budget.
- Full `docker compose up` of the production-image stack adds ~2 min of image-build time per CI run (no shared Docker cache between runners). Not worth it for an interaction-correctness gate.
- The CI run validates code as it would run in production with one exception: Caddy is bypassed. Tests hit `http://localhost:5173` (Vite) for the SPA and `http://localhost:3001/api/v1/*` (api) directly. The router-vs-routing distinction matters for some bugs (404s on `/v1/*` routes etc.) but those are caught by other tests (vitest mocks the api client).

**Alternatives considered**:
- **Full `docker compose up`**: more production-like; catches Caddy routing bugs. Rejected because CI time cost outweighs the marginal coverage gain.
- **All-in-Node (no docker)**: skip postgres/redis entirely via in-memory mocks. Rejected because the existing api code is hard-coupled to real postgres + redis; mocking them would require feature 020's runtime-config-store rewrites.

**Follow-up**: a separate `nightly` workflow that DOES run the full `docker compose up` stack against the live VM as a smoke. Tracked as US4 stretch goal; not in v1.

---

## R-003: Fake docker control in CI

**Decision**: The existing `globalThis.__supastackFakeDockerControl` hook (set during test setup) is the supported way to disable real container provisioning in api processes. Wire it in the CI stack by setting `NODE_ENV=test` + a new env var `SUPASTACK_TEST_FAKE_DOCKER=1` that the api respects at boot.

**Rationale**:
- The hook is already used by the integration test suite (60+ tests reference it). Established pattern.
- Adding a boot-time env var (`SUPASTACK_TEST_FAKE_DOCKER=1`) keeps the production build clean — the hook is only enabled when explicitly asked. No risk of accidentally shipping the fake to production.
- The hook lets `POST /api/v1/instances` succeed without actually starting containers; the auth-config GET / PATCH flow works against the snapshot row even when no per-instance docker stack exists.

**Alternatives considered**:
- **Run real per-instance docker provisioning**: ~30s per project × multiple projects = blows the 5-min budget.
- **Mock api-side via separate test build of the api image**: more invasive; introduces a divergent code path. Rejected.

**Implementation note**: `apps/api/src/services/docker-control-adapter.ts` already checks `globalThis.__supastackFakeDockerControl`. The new env var sets that global at boot time (in api's `server.ts` startup, gated by `SUPASTACK_TEST_FAKE_DOCKER === '1'`).

---

## R-004: Admin user seeding — re-runnability of `/setup`

**Decision**: `/setup` is single-use per stack. CI runs use a fresh disposable stack per PR run, so `/setup` runs exactly once at the start. Local re-runs need a manual DB wipe between full-suite invocations OR a "skip if exists" branch.

**Rationale**:
- The `/setup` endpoint guards itself via `setup_status.completed = true` — second call errors out.
- CI freshness is guaranteed (docker compose down + up at job start).
- For local re-runs, the developer typically runs `pnpm dev` once and keeps the stack alive across many `pnpm test:e2e` invocations — the admin user persists, the suite picks it up via the seeded credentials, no re-setup needed.
- For "I want a clean slate" the documented escape is `docker compose down -v && docker compose up -d` in `infra/`; quickstart.md spells this out.

**Alternatives considered**:
- **Auto-wipe on every test:e2e run**: too destructive for local dev (operator might have other state in the DB they care about).
- **Idempotent /setup endpoint**: would require a backend change unrelated to this feature.

---

## R-005: Console error matcher fidelity

**Decision**: Implement a small allowlist of expected console messages (regex set) and fail on anything not in the allowlist. Initial allowlist:

- `/React DevTools/i`
- `/Download the React DevTools/i`
- `/.*violates the following Content Security Policy.*style-src.*/i` (Tailwind dev-mode warning, false positive)
- Empty / repeated noise lines

Anything matching `Uncaught \w*Error` or React's hydration / hook-rules warnings fails the test.

**Rationale**:
- Pure "fail on any console.error" is too noisy in practice — DevTools and CSP dev-mode warnings produce harmless errors that would flake every test.
- A small allowlist is auditable: the list itself is part of the test fixture, so a PR adding to the allowlist signals intent.
- The patterns are conservative (anchored to known sources) — we don't allow blanket "ignore network failures" or "ignore React warnings".

**Alternatives considered**:
- **No console error check**: misses a class of regressions.
- **Hard fail on any console.error**: too flaky.
- **Production build for tests**: removes React dev warnings, but loses the page-coverage testability of dev-mode hot reload. Rejected.

---

## Out-of-research items (deferred to implementation)

- **Screenshot redactor pattern set** — concrete regex list lives in `redactor.ts`; not a spec gate. Initial patterns: `/sbp_[a-f0-9]{40}/`, `/Bearer [A-Za-z0-9._-]+/`, OAuth client secret formats per provider.
- **Page-coverage exception list** — concrete file names in `EXCLUDED_PAGES` const; updated as new top-level pages ship.
- **Allowlist additions** — handled by PR review; not a build-time gate.
