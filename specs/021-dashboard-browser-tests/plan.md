# Implementation Plan: Dashboard Browser-Level E2E Tests (Feature 021)

**Branch**: `021-dashboard-browser-tests` | **Date**: 2026-05-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/021-dashboard-browser-tests/spec.md`

## Summary

Stand up Playwright as the real-browser harness for the selfbase dashboard. Replace the existing placeholder specs at `apps/web/tests/e2e/*.spec.ts` with working implementations covering the operator paths vitest+jsdom cannot reach: sidebar navigation, Radix-portal drawer interactions, deep-link querystrings, and any-page-loads-without-console-errors smokes. Wire CI to run the suite on every PR against a disposable local stack; capture screenshots + console logs on failure with secrets redacted; gate merges on the result. Add an "expected pages" registry + lint step so adding a dashboard page requires adding a smoke.

Four implementation tracks:

- **Track A — Harness setup**: add `@playwright/test`, write `playwright.config.ts`, scripts in `apps/web/package.json` (`test:e2e`, `test:e2e:ui`), seeded admin fixture
- **Track B — Test authoring**: convert the 2 placeholder spec files + add new files for US1 (sidebar), US2 (Auth Providers), US3 (per-page smokes)
- **Track C — Coverage enforcement**: expected-pages registry + lint script that fails when a new page is added without a smoke
- **Track D — CI integration**: GitHub Actions job that boots the stack, runs the suite, uploads screenshot artifacts with redaction, posts a PR comment

No backend changes other than a small env-gated boot hook in `apps/api/src/server.ts` (T005, ~5 lines) that installs a fake docker control at `globalThis.__selfbaseFakeDockerControl` when `SELFBASE_TEST_FAKE_DOCKER=1`. Production builds (env unset) are unaffected. No new API endpoints. No new dashboard features. Otherwise pure test-harness work building on feature 020's surface.

## Technical Context

**Language/Version**: TypeScript 5.x, Node 20 LTS. Test specs are `.spec.ts` files run by `@playwright/test`.

**Primary Dependencies**:
- `@playwright/test` (NEW) — the test runner + browser automation. Version pinned to a current stable release; Chromium-only at v1.
- Existing dev stack: `vite` (web dev server), `tsx` (api), `pg` + `redis` via docker-compose for the test stack
- `pnpm` workspace tooling (existing) — `apps/web/package.json` gains the playwright dep
- GitHub Actions (existing CI) — adds one new job

**Storage**: Test stack uses a disposable docker-compose stack (postgres + redis + api + web) spun up per CI run. State is wiped on teardown. A seeded admin user is created during stack init via the existing `/setup` flow. The live-VM nightly variant uses a separate environment that we'll add as a follow-up workflow file.

**Testing**: This feature IS the test harness. Internal validation is done by:
1. Manually verifying each new spec passes locally with `pnpm test:e2e`
2. Verifying CI run completes in < 5 minutes (SC-003)
3. Deliberately breaking the sidebar in source → confirming the CI run fails with a clear error (US1 independent test)

**Target Platform**: Chromium browser (Playwright's default `chromium` channel). Linux runner for CI. macOS / Linux / Windows for local dev (Playwright's `npx playwright install --with-deps` handles platform-specific browser binaries).

**Project Type**: Web application (full-stack), tests live in `apps/web/tests/e2e/`.

**Performance Goals**:
- Full suite wall-clock < 5 min on CI runner (SC-003, FR-011)
- A single failing test produces its failure message + screenshot within ~30s of the failure point (no global timeout > 30s on individual assertions)
- Local suite startup (cold) < 30s (Playwright `install --with-deps` cached; stack boot < 20s)

**Constraints**:
- No live-VM dependency in CI (FR-008) — disposable local stack only.
- No per-instance Supabase project provisioning in CI (too slow / requires docker-in-docker) — tests that need a project use a pre-seeded fixture project created by the harness via api endpoints (`POST /api/v1/instances` with a known name) but stub out the per-instance docker container provisioning via the existing fake-docker-control hook (`globalThis.__selfbaseFakeDockerControl`). The auth-config GET works against a project even if its containers are mocked, because the snapshot path doesn't require running containers.
- Text artifacts (console logs, network panel JSON, JUnit reports) must redact known secret patterns (FR-009 v1 scope) — implement as a Playwright reporter that wraps the default `html` reporter and post-processes `.txt` / `.log` / `.json` files before they're zipped. PNG screenshots pass through unchanged; redaction tracked as a follow-up issue.
- Tests must not depend on real OAuth IdP roundtrips (Out of Scope) — Discord / Google etc. assertions stop at "drawer renders with the right fields" or "PATCH writes the env line", never "Google's consent screen appears".

**Scale/Scope**:
- ~10 spec files at merge time covering US1 + US2 + US3 (one spec per dashboard surface)
- Each spec ~50-150 lines
- One new CI job (~80 lines of yaml)
- One new lint script (~50 lines of TS)
- Expected-pages registry (~40 entries at merge time)

## Constitution Check

No project constitution defined (template only). Conventions from `CLAUDE.md`:

- **One BullMQ job per concern**: N/A (no jobs)
- **Migrations idempotent**: N/A (no migrations)
- **Tests prefer pure functions where possible**: Browser tests are inherently impure; that's the point of this feature. Doesn't conflict with the convention because the convention is about *unit* tests.
- **`any` in tests is allowed** (per `eslint.config.js`): we use it where Playwright's typed `Locator` etc. add no value over direct DOM assertion.
- **Spec-driven dev**: this plan is the spec-driven artifact for #21 (021-dashboard-browser-tests).

All gates pass.

## Project Structure

### Documentation (this feature)

```text
specs/021-dashboard-browser-tests/
├── plan.md              ← this file
├── spec.md
├── research.md          ← Phase 0 — Playwright vs alternatives, CI stack choices
├── data-model.md        ← Phase 1 — Expected-pages registry shape, fixture model
├── quickstart.md        ← Phase 1 — Local + CI run instructions, debugging tips
├── contracts/
│   └── expected-pages.md     ← The registry consumers (lint + tests) read
└── tasks.md             ← Phase 2 (generated by /speckit-tasks)
```

### Source Code (files created or modified)

```text
# ─── Harness setup (Track A) ──────────────────────────────────────────────

apps/web/package.json                  MODIFIED — add @playwright/test devDep + scripts
apps/web/playwright.config.ts          NEW — base URL, reporters, screenshot config, redaction
apps/web/tests/e2e/fixtures/
  admin-session.ts                     NEW — Playwright fixture: seeded admin user + logged-in browser context
  test-project.ts                      NEW — fixture: pre-seeded project ref the suite uses for project-shell tests
  test-utils.ts                        NEW — helpers (waitForRoute, expectNoConsoleErrors, etc.)

# ─── Test specs (Track B) ──────────────────────────────────────────────────

apps/web/tests/e2e/
  golden-path.spec.ts                  REWRITTEN — implements the placeholder; covers setup → login → instance create → reveal credentials
  invite-flow.spec.ts                  REWRITTEN — implements the placeholder
  sidebar-nav.spec.ts                  NEW — US1: asserts every expected sidebar entry on the project shell + settings shell
  auth-providers.spec.ts               NEW — US2: list renders, drawer opens on click, deep-link `?provider=Slack (OIDC)`, RBAC hides Save
  page-smokes.spec.ts                  NEW — US3: one test per critical page, asserts headline + zero console errors

# ─── Coverage enforcement (Track C) ────────────────────────────────────────

apps/web/tests/e2e/expected-pages.ts   NEW — single source of truth: array of { path, headline, sidebarGroup, sidebarLabel }
apps/web/scripts/check-page-coverage.mjs  NEW — lint script: diffs files under src/pages/*.tsx against expected-pages.ts; fails on drift
apps/web/package.json                  MODIFIED — add `lint:page-coverage` script

# ─── Secret redaction (Track A) ────────────────────────────────────────────

apps/web/tests/e2e/redactor.ts         NEW — post-processes Playwright artifacts to scrub sbp_*, OAuth secrets, AWS keys
apps/web/tests/e2e/playwright-reporter.ts  NEW — Playwright Reporter that calls redactor on every captured screenshot + log

# ─── CI integration (Track D) ──────────────────────────────────────────────

.github/workflows/ci.yml               MODIFIED — add `e2e` job: docker compose up → wait healthy → pnpm test:e2e → upload artifacts
.github/workflows/e2e-nightly.yml      NEW (optional) — nightly run against supaviser.dev for live-VM verification

# ─── Docs ──────────────────────────────────────────────────────────────────

docs/changes/021-dashboard-browser-tests.md  NEW — operator/developer runbook: how to run locally, how to add a test, debugging CI failures
```

**Structure Decision**: All web-side test infrastructure under `apps/web/tests/e2e/`. The CI job sits in the existing `.github/workflows/ci.yml`. The coverage-lint script lives next to other web scripts under `apps/web/scripts/`. No backend code touched.

## Implementation Design

### Track A — Harness setup

#### A1. `apps/web/package.json` additions

```jsonc
"devDependencies": {
  "@playwright/test": "^1.49.0",
  // ... existing deps
},
"scripts": {
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui",
  "test:e2e:headed": "playwright test --headed",
  "lint:page-coverage": "node scripts/check-page-coverage.mjs"
}
```

`pnpm install` brings in the dep. `pnpm exec playwright install --with-deps chromium` installs the browser binary (run once locally; CI script does this in setup).

#### A2. `apps/web/playwright.config.ts`

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Each spec gets a fresh browser context (admin fixture seeds session anew).
  fullyParallel: false,  // shared seeded user state; serial keeps it simple
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['./tests/e2e/playwright-reporter.ts'],  // redaction reporter
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: !process.env.PLAYWRIGHT_HEADED,
  },
  projects: [{ name: 'chromium', use: { channel: 'chromium' } }],
  // Global timeout: a single test ≤ 60s; the whole suite ≤ 5min (SC-003).
  timeout: 60_000,
  globalTimeout: 5 * 60_000,
});
```

#### A3. Admin session fixture (`apps/web/tests/e2e/fixtures/admin-session.ts`)

A Playwright fixture that — before each spec — logs in via the dashboard's `/api/v1/auth/login` endpoint with a seeded admin user, stashes the session cookie in `storageState`, and reuses it across tests in the same spec file. The first time a spec runs locally, the fixture POSTs to `/api/v1/setup` to bootstrap an admin user if the stack is fresh.

```ts
import { test as base } from '@playwright/test';

export const test = base.extend<{ adminContext: import('@playwright/test').BrowserContext }>({
  adminContext: async ({ browser }, use) => {
    const ctx = await browser.newContext({
      storageState: await loadOrCreateAdminStorageState(),
    });
    await use(ctx);
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
```

`loadOrCreateAdminStorageState` is the seed-or-load helper.

#### A4. Test-project fixture (`apps/web/tests/e2e/fixtures/test-project.ts`)

Creates one fixture project on first use (via `POST /api/v1/instances` against the test stack). Caches the ref in `globalThis` for subsequent tests in the same run. The fixture relies on the existing fake-docker-control hook for the test stack — instances "provision" without actually spinning up real per-instance containers, but the snapshot + auth-config paths work.

Justification for the fake-docker-control reuse: feature 009 + 010 + 020 all use this pattern in their integration tests, so the harness inherits it.

### Track B — Test specs

#### B1. `sidebar-nav.spec.ts` (US1)

```ts
import { test, expect } from './fixtures/admin-session';
import { EXPECTED_PAGES, PROJECT_SHELL_GROUPS } from './expected-pages';
import { testProjectRef } from './fixtures/test-project';

test('project shell sidebar contains every expected group + entry', async ({ adminContext }) => {
  const ref = await testProjectRef();
  const page = await adminContext.newPage();
  await page.goto(`/dashboard/project/${ref}`);

  for (const group of PROJECT_SHELL_GROUPS) {
    await expect(page.getByText(group.heading, { exact: true })).toBeVisible();
    for (const item of group.items) {
      await expect(
        page.getByRole('link', { name: item.label, exact: true }),
      ).toHaveAttribute('href', `/dashboard/project/${ref}${item.suffix}`);
    }
  }
});

test('each sidebar link routes to a non-404 page', async ({ adminContext }) => {
  // For each link, click it, assert the URL changed + a known heading appears.
  // Detail in expected-pages.ts entry.
});
```

#### B2. `auth-providers.spec.ts` (US2)

Covers the 4 acceptance scenarios from spec US2: list rendering, Google drawer fields, Slack OIDC deep-link, non-admin RBAC. Each is one `test()`.

```ts
import { test, expect } from './fixtures/admin-session';
import { testProjectRef } from './fixtures/test-project';

test.describe('Auth Providers page', () => {
  test('providers list contains expected rows', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${await testProjectRef()}/auth/providers`);
    for (const name of ['Email', 'Phone', 'Google', 'GitHub', 'Apple', 'Slack (OIDC)', 'Slack (Deprecated)', 'SAML 2.0']) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
  });

  test('Google drawer opens with expected fields', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${await testProjectRef()}/auth/providers`);
    await page.getByRole('button', { name: /^Google$/ }).click();
    await expect(page.getByLabel('Client IDs')).toBeVisible();
    await expect(page.getByLabel('Client Secret (for OAuth)')).toBeVisible();
    await expect(page.getByLabel('Callback URL (for OAuth)')).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeDisabled();
  });

  test('deep-link ?provider=Slack (OIDC) opens the OIDC drawer', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto(
      `/dashboard/project/${await testProjectRef()}/auth/providers?provider=Slack%20(OIDC)`,
    );
    await expect(page.getByText('Slack (OIDC)', { exact: true })).toBeVisible();
    // OIDC drawer writes to external_slack_oidc_* — assertion on the input label
    // distinguishes it from the legacy Slack drawer (no `(OIDC)` heading).
  });

  test('non-admin role hides Save buttons', async ({ browser }) => {
    // ... use a memberContext fixture; assert no "Save changes" button is in the DOM
  });
});
```

#### B3. `page-smokes.spec.ts` (US3)

A single spec file with one test per page, driven by `EXPECTED_PAGES`:

```ts
import { test, expect } from './fixtures/admin-session';
import { EXPECTED_PAGES } from './expected-pages';

for (const { path, headline, requiresProject } of EXPECTED_PAGES) {
  test(`page renders: ${path}`, async ({ adminContext }) => {
    const url = requiresProject
      ? path.replace('{ref}', await testProjectRef())
      : path;
    const page = await adminContext.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (msg) => msg.type() === 'error' && consoleErrors.push(msg.text()));
    await page.goto(url);
    await expect(page.getByRole('heading', { name: headline })).toBeVisible();
    expect(consoleErrors, `console errors on ${url}: ${consoleErrors.join('\n')}`).toHaveLength(0);
  });
}
```

#### B4. `golden-path.spec.ts` (rewrite of placeholder)

End-to-end: setup → login → create instance → reveal credentials → backup → pause → resume → delete. Mirrors the existing placeholder docstring.

#### B5. `invite-flow.spec.ts` (rewrite of placeholder)

Two browser contexts: admin invites, second context accepts, member sees the list. Mirrors the existing placeholder docstring.

### Track C — Coverage enforcement

#### C1. `expected-pages.ts`

Single source of truth for the suite:

```ts
export const PROJECT_SHELL_GROUPS = [
  {
    heading: 'Configuration',
    items: [
      { label: 'General',    suffix: '' },
      { label: 'API Keys',   suffix: '/api-keys' },
      { label: 'JWT Keys',   suffix: '/jwt-keys' },
      { label: 'Secrets',    suffix: '/secrets' },
      { label: 'Backups',    suffix: '/backups' },
    ],
  },
  {
    heading: 'Authentication',
    items: [{ label: 'Providers', suffix: '/auth/providers' }],
  },
  {
    heading: 'Diagnostics',
    items: [{ label: 'Health', suffix: '/health' }],
  },
] as const;

export const EXPECTED_PAGES = [
  { path: '/dashboard/project/{ref}',                  headline: 'General',       requiresProject: true },
  { path: '/dashboard/project/{ref}/api-keys',         headline: 'API Keys',      requiresProject: true },
  { path: '/dashboard/project/{ref}/jwt-keys',         headline: 'JWT Keys',      requiresProject: true },
  { path: '/dashboard/project/{ref}/secrets',          headline: 'Secrets',       requiresProject: true },
  { path: '/dashboard/project/{ref}/backups',          headline: 'Backups',       requiresProject: true },
  { path: '/dashboard/project/{ref}/auth/providers',   headline: 'Auth Providers', requiresProject: true },
  { path: '/dashboard/project/{ref}/health',           headline: 'Health',        requiresProject: true },
  { path: '/settings/members',                         headline: 'Members',       requiresProject: false },
  { path: '/settings/tokens',                          headline: 'Personal Tokens', requiresProject: false },
  { path: '/settings/audit',                           headline: 'Audit',         requiresProject: false },
  { path: '/settings/database',                        headline: 'Database',      requiresProject: false },
  { path: '/settings/cli',                             headline: 'CLI',           requiresProject: false },
  { path: '/settings/mcp-clients',                     headline: 'MCP Clients',   requiresProject: false },
  { path: '/dashboard',                                headline: 'Projects',      requiresProject: false },
] as const;
```

#### C2. `apps/web/scripts/check-page-coverage.mjs`

Reads filesystem under `apps/web/src/pages/*.tsx`, reads `EXPECTED_PAGES` from `apps/web/tests/e2e/expected-pages.ts`, asserts every page file maps to an entry. Fails the lint with a clear message: `Page src/pages/NewFeature.tsx has no entry in expected-pages.ts — add one or document why it's not user-visible.`

Wired into the existing `pnpm lint` chain so it runs in CI.

### Track A continued — Secret redaction

#### A5. `apps/web/tests/e2e/redactor.ts`

Pure function that takes a string (log line, file content) and returns a redacted version. Patterns:

- `/sbp_[a-f0-9]{40}/g` → `sbp_REDACTED`
- `/[A-Za-z0-9_-]{32,}(?=\\.\\.\\.)/g` → context-dependent; rule-of-thumb: anything matching `Authorization: Bearer .+`
- OAuth secrets are harder; conservative approach: any HTTP request body field whose key matches `/secret|token|password|key/i` gets `<REDACTED>` regardless of value

#### A6. `apps/web/tests/e2e/playwright-reporter.ts`

Custom Playwright `Reporter` implementation:

```ts
import type { Reporter, TestResult } from '@playwright/test/reporter';
import { redact } from './redactor';

export default class RedactingReporter implements Reporter {
  onTestEnd(_test, result: TestResult) {
    for (const attachment of result.attachments) {
      if (attachment.contentType?.startsWith('image/')) continue; // images don't carry text
      if (attachment.body) {
        attachment.body = Buffer.from(redact(attachment.body.toString('utf8')));
      }
      if (attachment.path) {
        // Read file, redact, write back. Synchronous OK for ≤ a few hundred files.
      }
    }
  }
}
```

### Track D — CI integration

#### D1. `.github/workflows/ci.yml` — new `e2e` job

```yaml
e2e:
  name: e2e browser tests
  runs-on: ubuntu-latest
  needs: [guardrails]    # only run after lint/format passes
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: '20' }
    - uses: pnpm/action-setup@v4
    - run: pnpm install --frozen-lockfile
    - run: pnpm exec playwright install --with-deps chromium
    - name: Start stack
      working-directory: infra
      run: |
        cp .env.example .env
        echo "MASTER_KEY=$(openssl rand -hex 32)" >> .env
        echo "CONTROL_DB_PASSWORD=$(openssl rand -hex 16)" >> .env
        echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env
        # ... other required vars
        sudo docker compose --env-file .env up -d
        # Wait for api healthcheck
        until curl -fsS http://localhost:3001/api/v1/health; do sleep 2; done
    - name: Seed admin user
      run: |
        curl -X POST http://localhost:3001/api/v1/setup \
          -H 'Content-Type: application/json' \
          -d '{"email":"admin@test.local","password":"hunter2hunter2","orgName":"e2e","apexDomain":"test.local"}'
    - name: Run Playwright suite
      env:
        PLAYWRIGHT_BASE_URL: http://localhost:5173
      run: pnpm --filter @selfbase/web test:e2e
    - name: Upload Playwright report on failure
      if: failure()
      uses: actions/upload-artifact@v4
      with:
        name: playwright-report
        path: apps/web/playwright-report/
        retention-days: 14
    - name: Comment PR on failure
      if: failure() && github.event_name == 'pull_request'
      uses: actions/github-script@v7
      with:
        script: |
          github.rest.issues.createComment({
            issue_number: context.issue.number,
            owner: context.repo.owner,
            repo: context.repo.repo,
            body: '❌ Browser-test job failed. See [run](${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}) for screenshots.',
          })
```

#### D2. `.github/workflows/e2e-nightly.yml` (optional)

Cron-triggered (nightly) job that runs the suite against `supaviser.dev` with a real PAT secret. Lower priority; ship later if useful.

## Phase 0: Outline & Research

Open questions that need explicit decisions before implementation:

1. **Playwright vs Cypress vs Puppeteer**. Repo has Playwright placeholder shells; package.json doesn't have the dep installed. Decision needed: stay with Playwright (recommended — better tracing, parallel-by-default, first-class TypeScript).

2. **Disposable CI stack — docker-in-docker vs pnpm dev**. Two options for the CI test target:
   - (a) `docker compose up -d` the full stack (api + web + db + redis + caddy) on the GitHub runner
   - (b) `pnpm dev` to run api + web as Node processes, plus only db + redis via docker
   
   (a) most production-like; (b) ~3× faster to start. Decision needed.

3. **Fake docker control in CI**. Tests need a "project" to render the auth-providers page. The existing fake-docker-control hook (`globalThis.__selfbaseFakeDockerControl`) lets the api accept project creation without actually provisioning containers. Confirm this hook is exposed in the production api build OR add a test-only env var that enables it.

4. **Admin user seeding**. The api exposes `POST /api/v1/setup` which is single-use (only works once per stack). Confirm we can re-run it on a freshly-spawned stack each CI run, OR use a one-time seed SQL.

5. **Console error matcher fidelity**. `page.on('console')` captures ALL console output; not all `error` level messages indicate a real bug (e.g. React DevTools' "Download the React DevTools" message logs at `error` level in some versions). Decision needed: maintain an allowlist regex of expected console errors, or fail on any.

Each gets a Decision / Rationale / Alternatives entry in `research.md`.

## Phase 1: Design & Contracts

### `data-model.md`

- `ExpectedPage` — `{ path: string, headline: string, requiresProject: boolean }`
- `SidebarGroup` — `{ heading: string, items: SidebarItem[] }`
- `SidebarItem` — `{ label: string, suffix: string }`
- `AdminContext` — Playwright fixture data: cookie storage state + project ref + cleanup hook

### `contracts/expected-pages.md`

Documents the registry's invariants:
- Every file under `apps/web/src/pages/*.tsx` matching `Project*.tsx` or `Settings*.tsx` MUST have a corresponding `EXPECTED_PAGES` entry.
- Exceptions (e.g. `Login.tsx`, `Setup.tsx`, `AcceptInvite.tsx`) are listed in an explicit `EXCLUDED_PAGES` const with reasons.
- Adding a new entry requires both the spec assertion AND a non-stub PR description.

### `quickstart.md`

Per-developer instructions:
- First-time setup: `pnpm install && pnpm exec playwright install --with-deps chromium`
- Running locally: `pnpm dev` (in one terminal) + `pnpm --filter @selfbase/web test:e2e` (in another)
- UI mode for debugging: `pnpm --filter @selfbase/web test:e2e:ui`
- Common failure modes + how to fix them (stale browser, port conflicts, seed-user collision)
- How to add a new test for a new dashboard page

Plus the agent context update: replace the `<!-- SPECKIT START -->` … `<!-- SPECKIT END -->` block in `CLAUDE.md` to point at `specs/021-dashboard-browser-tests/plan.md`.

## Complexity Tracking

No constitution violations. One pragmatic deviation worth flagging:

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Tests use the fake-docker-control hook to "provision" projects without real containers | A real per-instance Supabase stack takes ~30s to come up; multiplied across many tests, the suite would exceed the 5-min SC-003 budget. Existing integration tests use the same hook, so the harness inherits the pattern. | A real-container CI stack would be more production-like, but the cost (slower runs, flakier CI, docker-in-docker complexity) outweighs the benefit for an interaction-correctness gate. Full-stack provisioning is covered by the existing `tests/integration/provision-instance.test.ts` (which runs against real docker in dev). |
