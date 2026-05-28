import { test, expect } from './fixtures/admin-session';
import { testProjectRef } from './fixtures/test-project';
import { expectNoConsoleErrors, resolvePath } from './fixtures/test-utils';
import { EXPECTED_PAGES } from './expected-pages';

/**
 * US3 — one assertion per critical dashboard page.
 *
 * Spec: specs/021-dashboard-browser-tests/spec.md US3, FR-005, SC-004
 * Plan: specs/021-dashboard-browser-tests/plan.md §B3
 * Task: T018
 *
 * For each entry in EXPECTED_PAGES, generate one `test()` block that:
 *   1. Resolves the path's `{ref}` placeholder via the test-project fixture
 *      if `requiresProject`
 *   2. Navigates to the page
 *   3. Asserts the expected headline is visible
 *   4. Asserts no unexpected console errors leaked (filtered by allowlist)
 *
 * Adding a new page to EXPECTED_PAGES automatically gets a smoke. The
 * coverage lint (T022) enforces that new files under src/pages/ get an entry.
 */
test.describe('Dashboard page smokes', () => {
  for (const entry of EXPECTED_PAGES) {
    test(`renders: ${entry.path}`, async ({ adminContext }) => {
      const ref = entry.requiresProject ? await testProjectRef() : '';
      const url = resolvePath(entry.path, ref);

      const page = await adminContext.newPage();
      const consoleAssertion = expectNoConsoleErrors(page);

      await page.goto(url);

      // Some pages render their title both as a page-level <h1> AND as a
      // section heading further down (API Keys, Secrets, Auth Providers).
      // `.first()` anchors on the page-level h1 which appears first in DOM
      // order.
      await expect(
        page.getByRole('heading', { name: entry.headline }).first(),
        `expected heading "${entry.headline}" on ${url}`,
      ).toBeVisible({ timeout: 10_000 });

      consoleAssertion.assert();
    });
  }
});
