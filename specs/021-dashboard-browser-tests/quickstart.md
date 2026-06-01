# Quickstart: Dashboard Browser-Level E2E Tests

**Feature**: 021-dashboard-browser-tests | **Date**: 2026-05-28

How to run, extend, and debug the browser-test suite.

---

## First-time local setup

```bash
# At the repo root
pnpm install --frozen-lockfile

# Install Chromium for Playwright (one-time per machine)
pnpm --filter @supastack/web exec playwright install --with-deps chromium
```

---

## Running the suite locally

You need three terminals:

1. **The stack** (postgres + redis):
   ```bash
   cd infra
   sudo docker compose --env-file .env up -d db redis
   ```

2. **api + web dev servers**:
   ```bash
   SUPASTACK_TEST_FAKE_DOCKER=1 pnpm dev
   ```

   The `SUPASTACK_TEST_FAKE_DOCKER=1` env var makes the api use the fake docker control — `POST /api/v1/instances` succeeds without spinning up real per-instance containers.

3. **The Playwright suite**:
   ```bash
   pnpm --filter @supastack/web test:e2e
   ```

   Or in interactive UI mode (great for debugging):
   ```bash
   pnpm --filter @supastack/web test:e2e:ui
   ```

---

## What gets tested

| Spec                         | What it covers                                                                 |
|------------------------------|--------------------------------------------------------------------------------|
| `sidebar-nav.spec.ts`        | Every expected sidebar group + entry renders on the project shell             |
| `auth-providers.spec.ts`     | Auth Providers page list, drawer open/close, deep-link, RBAC                  |
| `page-smokes.spec.ts`        | One assertion per critical dashboard page (heading visible, no console errors)|
| `golden-path.spec.ts`        | End-to-end: setup → login → create instance → reveal creds → backup → pause   |
| `invite-flow.spec.ts`        | Admin invites, second context accepts, member sees the list                   |

---

## Smoke verification (post-implementation)

### Smoke 1 — Sidebar regression caught

```bash
# 1. Edit ProjectShell.tsx, remove the "Authentication" group
# 2. Run the suite
pnpm --filter @supastack/web test:e2e -- sidebar-nav.spec.ts
# Expected: ❌ test fails with "expected Authentication heading visible, got: null"
# Screenshot artifact in apps/web/playwright-report/
```

### Smoke 2 — Auth Providers drawer

```bash
pnpm --filter @supastack/web test:e2e -- auth-providers.spec.ts
# Expected: ✓ 4 tests pass
#   ✓ providers list contains expected rows
#   ✓ Google drawer opens with expected fields
#   ✓ deep-link ?provider=Slack (OIDC) opens the OIDC drawer
#   ✓ non-admin role hides Save buttons
```

### Smoke 3 — Per-page coverage gate

```bash
# 1. Add a new file apps/web/src/pages/NewFeaturePage.tsx
# 2. Run the lint
pnpm --filter @supastack/web lint:page-coverage
# Expected: ❌ NewFeaturePage.tsx has no browser-test smoke
```

### Smoke 4 — Console error allowlist

```bash
# 1. Add a deliberate console.error to ProjectGeneral.tsx
# 2. Run the suite
pnpm --filter @supastack/web test:e2e -- page-smokes.spec.ts
# Expected: ❌ "page renders: /dashboard/project/{ref}" fails with the console error message
```

### Smoke 5 — Secret redaction in artifacts

```bash
# 1. Force a test failure on a page that displays a PAT (e.g. /settings/tokens)
# 2. Inspect the screenshot under playwright-report/
# Expected: any sbp_* PAT in the captured screenshot is overwritten with "sbp_REDACTED"
# (Note: image-redaction is hard; the redactor handles text artifacts. PNG screenshots get a
# best-effort overlay only for known display contexts. See research R-005.)
```

### Smoke 6 — Full suite completes in < 5 minutes

```bash
time pnpm --filter @supastack/web test:e2e
# Expected: real time < 5m00s
```

### Smoke 7 — CI artifact upload on failure

After a deliberately-broken PR run:
1. Open the PR check page
2. Verify the `e2e` job has an attached `playwright-report` artifact
3. Download and verify it contains screenshots + the HTML report
4. Verify the secret-redaction is applied (grep `sbp_` in the artifact's text contents — should not find a real PAT)

---

## Adding a new test

### For a new dashboard page

1. **Add the page to the registry**:
   ```ts
   // apps/web/tests/e2e/expected-pages.ts
   export const EXPECTED_PAGES = [
     // ...existing entries
     {
       path: '/dashboard/project/{ref}/new-feature',
       headline: 'New Feature',
       requiresProject: true,
       sourceFile: 'NewFeaturePage.tsx',
     },
   ];
   ```

2. **Run the lint to verify**:
   ```bash
   pnpm --filter @supastack/web lint:page-coverage
   # Should pass — no message
   ```

3. **The per-page smoke is automatic** — `page-smokes.spec.ts` iterates over `EXPECTED_PAGES`, so your new page gets a smoke for free.

### For a new interaction within an existing page

1. Either add a new `test()` block to the existing spec (e.g. `auth-providers.spec.ts`), or
2. Create a new spec file under `apps/web/tests/e2e/` if the interaction is large enough to warrant its own file.

Use the existing patterns:

```ts
import { test, expect } from './fixtures/admin-session';
import { testProjectRef } from './fixtures/test-project';

test('description of what this verifies', async ({ adminContext }) => {
  const page = await adminContext.newPage();
  await page.goto(`/dashboard/project/${await testProjectRef()}/some-path`);
  // ...assertions
});
```

---

## Debugging CI failures

When the `e2e` job fails on a PR:

1. **Check the PR comment** — the bot posts a link to the failing run with the test name + assertion message.
2. **Download the `playwright-report` artifact** from the run page.
3. **Open `index.html`** in a browser — Playwright's HTML report shows traces, screenshots, and video for every failed test.
4. **Common failure modes**:
   - Stale Playwright browser binary in cache → rerun the job (CI re-installs); fixes itself.
   - Race condition between stack-boot and test start → check the "Wait for healthcheck" step; bump the curl-loop timeout if needed.
   - Real regression → reproduce locally with `pnpm --filter @supastack/web test:e2e -- <spec-file>`.

---

## Resetting local state

If the suite gets into a weird state (corrupted admin user, stale cookies, etc.):

```bash
# Wipe everything
cd infra
sudo docker compose down -v
sudo docker compose --env-file .env up -d db redis

# Then re-seed admin via pnpm dev's first-run flow
SUPASTACK_TEST_FAKE_DOCKER=1 pnpm dev
# Visit http://localhost:5173/setup and complete with the seeded admin email/password
# Or run the suite — the admin-session fixture will auto-setup on first run
```
