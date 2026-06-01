# Feature 021 — Dashboard Browser-Level E2E Tests

**Closes**: nothing directly — feature exists to close a _class_ of bug (silent dashboard regressions that pass vitest+jsdom but break in a real browser, as exposed during feature 020's deploy).
**Spec**: [specs/021-dashboard-browser-tests/](../../specs/021-dashboard-browser-tests/)

## Why this feature exists

During the feature 020 deploy on 2026-05-28, a sidebar entry that shipped in source ("Authentication → Providers") failed to render in the operator's browser. The repo's tests caught zero of the conditions that produced the gap:

- vitest+jsdom proved the destination page rendered
- backend contract tests proved the API worked
- behavioral parity bash scripts proved PATCH→container worked

None of them rendered the actual SPA inside a real browser. This feature adds Playwright as the real-browser harness, plus a self-maintaining coverage floor so future dashboard pages can't slip through without a smoke.

## What you get

| Capability                                               | Where                                          |
| -------------------------------------------------------- | ---------------------------------------------- |
| Playwright runner against the deployed dashboard         | `apps/web/tests/e2e/*.spec.ts`                 |
| Admin-session fixture (auto-bootstrap on first run)      | `apps/web/tests/e2e/fixtures/admin-session.ts` |
| Member-session fixture (for non-admin RBAC tests)        | same file                                      |
| Test-project fixture (cached across the run)             | `apps/web/tests/e2e/fixtures/test-project.ts`  |
| Sidebar regression catcher (the bug that motivated this) | `apps/web/tests/e2e/sidebar-nav.spec.ts`       |
| Auth Providers drawer / deep-link / RBAC coverage        | `apps/web/tests/e2e/auth-providers.spec.ts`    |
| One assertion per critical dashboard page                | `apps/web/tests/e2e/page-smokes.spec.ts`       |
| Coverage lint that fails CI on new-page-without-smoke    | `apps/web/scripts/check-page-coverage.mjs`     |
| Secret redactor for screenshot/log artifacts             | `apps/web/tests/e2e/redactor.ts` + reporter    |
| GitHub Actions `e2e` job — runs on every PR              | `.github/workflows/ci.yml`                     |

## Running locally

First-time setup (run once per dev machine):

```bash
pnpm install
pnpm --filter @supastack/web exec playwright install --with-deps chromium
```

Day-to-day:

```bash
# Terminal 1 — postgres + redis
cd infra
sudo docker compose --env-file .env up -d db redis

# Terminal 2 — api + web dev servers
SUPASTACK_TEST_FAKE_DOCKER=1 pnpm dev

# Terminal 3 — run the suite
pnpm --filter @supastack/web test:e2e

# Or open the interactive UI for debugging
pnpm --filter @supastack/web test:e2e:ui
```

Run a single spec:

```bash
pnpm --filter @supastack/web test:e2e -- sidebar-nav.spec.ts
pnpm --filter @supastack/web test:e2e -- auth-providers.spec.ts
pnpm --filter @supastack/web test:e2e -- page-smokes.spec.ts
```

## What `SUPASTACK_TEST_FAKE_DOCKER=1` does

When set, the api installs a stub at `globalThis.__supastackFakeDockerControl` that no-ops `restart` and `waitHealthy`. This means `POST /api/v1/instances` (project creation) succeeds without actually spinning up per-instance docker stacks — every browser test that needs a project gets one in ~1 second instead of ~30. Production builds with the env var unset are unaffected.

## What the coverage lint does

`pnpm lint` (or `pnpm --filter @supastack/web lint:page-coverage` standalone) runs `apps/web/scripts/check-page-coverage.mjs`:

1. Lists files under `apps/web/src/pages/*.tsx` matching the dashboard-page name convention.
2. Reads `EXPECTED_PAGES` + `EXCLUDED_PAGES` from `apps/web/tests/e2e/expected-pages.ts`.
3. Fails with a clear message if any file is in neither set OR if a registry entry references a deleted file.

This means adding a new dashboard page to `apps/web/src/pages/` automatically triggers a CI failure until you add it to `EXPECTED_PAGES` (with the per-page smoke generated automatically by `page-smokes.spec.ts`) OR explicitly list it in `EXCLUDED_PAGES` with a written reason.

Three failure modes verified during T024:

```
❌ apps/web/src/pages/NewFeature.tsx has no browser-test smoke.
   To fix: add an entry to EXPECTED_PAGES in apps/web/tests/e2e/expected-pages.ts,
   OR add it to EXCLUDED_PAGES with a reason.
```

```
❌ Registry entries reference missing files:
     ProjectTestStub.tsx
   To fix: remove the stale entry from apps/web/tests/e2e/expected-pages.ts.
```

```
✓ check-page-coverage: 21 dashboard-page files all covered or excluded
```

## Adding a new test for a new dashboard page

1. **Register the page**:

   ```ts
   // apps/web/tests/e2e/expected-pages.ts
   {
     path: '/dashboard/project/{ref}/new-feature',
     headline: 'New Feature',
     requiresProject: true,
     sourceFile: 'ProjectNewFeature.tsx',
   },
   ```

2. **Run the lint** to verify:

   ```bash
   pnpm --filter @supastack/web lint:page-coverage
   # ✓ check-page-coverage: 22 dashboard-page files all covered or excluded
   ```

3. **`page-smokes.spec.ts` automatically picks it up** — the loop iterates over `EXPECTED_PAGES`, so your new page gets a "renders without console errors" smoke for free.

4. For deeper coverage (drawer interactions, RBAC, specific button states), either add a test block to the existing spec for that area OR create a new spec file under `apps/web/tests/e2e/`.

## CI behavior

The `e2e` job in `.github/workflows/ci.yml`:

1. Triggers on every `pull_request` and `push` to main
2. Spins up postgres + redis via docker compose
3. Generates fresh secrets via `openssl rand -hex`
4. Boots api + web (with `SUPASTACK_TEST_FAKE_DOCKER=1`)
5. Polls both healthchecks
6. Runs the full Playwright suite
7. On failure: uploads screenshots + traces + api/web logs as a build artifact, posts a PR comment with the run link and local-repro command

Artifact retention: 14 days. Job timeout: 15 min.

## Reading a CI failure

1. Click the failing `e2e` check on the PR.
2. The Playwright run output names the failing test + assertion message.
3. Download the `playwright-report-${run_id}` artifact.
4. Open `index.html` from the unzipped artifact — Playwright's HTML report shows traces, screenshots, and video for each failed test.
5. Reproduce locally with the command in the PR comment.

## Secret redaction

The `RedactingReporter` (`apps/web/tests/e2e/playwright-reporter.ts`) walks every captured artifact:

- **In-memory text** (JUnit reports, JSON network panels) — secret patterns are replaced with stable tokens (`sbp_REDACTED`, `Bearer REDACTED`, `sb_sid=REDACTED`)
- **File-backed text artifacts** (`.txt`, `.log`, `.json`, `.html`) — same patterns
- **Image attachments** (PNGs) — pass through unchanged. PNG redaction requires OCR; out of scope for v1. Tracked as a follow-up if a real leak surfaces.

Patterns are defined in `apps/web/tests/e2e/redactor.ts`. Adding a new pattern is a one-line array addition.

## What's NOT in this feature

Listed in spec §Out of Scope; each may become its own future feature if motivated:

- Visual regression / pixel-diff testing (screenshots are diagnostic, not goldens)
- Performance / load testing
- Multi-browser coverage (Chromium only at v1)
- Accessibility audits
- Mobile / responsive layout testing
- Browser-level testing of the per-instance Supabase Studio
- Real OAuth IdP roundtrips with Google/GitHub/etc.
- A nightly workflow against the live VM (planned, deferred)

## Troubleshooting

**The admin fixture says "could not obtain admin session"** — the api isn't running OR the api can't reach the DB. Check `lsof -i :3001` and `docker compose ps`.

**The test-project fixture errors with "could not create test project"** — `SUPASTACK_TEST_FAKE_DOCKER=1` isn't set on the api process. Without it, the create call tries to spin a real per-instance stack and times out.

**Suite says "browser not installed"** — run `pnpm --filter @supastack/web exec playwright install --with-deps chromium`.

**Tests pass locally but fail in CI** — most likely a timing issue. Increase the per-test timeout in `playwright.config.ts` or add an explicit `await expect(...).toBeVisible({ timeout: N })`.

**Stale storage state** — delete `apps/web/tests/e2e/.auth/` to force a fresh login on next run.

## Related issues + follow-ups

This feature was scoped tight on purpose. The following are reasonable follow-up issues to file as motivation arises:

- Visual regression testing (pixel-diff against baselines)
- Multi-browser coverage (Firefox / WebKit)
- Accessibility audit pass (axe-core in CI)
- Mobile / responsive layout suite
- Nightly workflow against `supaviser.dev`
- PNG screenshot redaction (overlay rectangles over known display regions OR OCR-based)
- Allow parallel test execution (`fullyParallel: true`) once fixtures are proven stable
