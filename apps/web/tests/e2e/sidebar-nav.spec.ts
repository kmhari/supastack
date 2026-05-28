import { test, expect } from './fixtures/admin-session';
import { testProjectRef } from './fixtures/test-project';
import { PROJECT_SHELL_GROUPS } from './expected-pages';

/**
 * US1 — sidebar regression caught by CI.
 *
 * Spec: specs/021-dashboard-browser-tests/spec.md US1, FR-003
 * Plan: specs/021-dashboard-browser-tests/plan.md §B1
 * Task: T012
 *
 * This is the canonical assertion that motivated feature 021. Removing any
 * sidebar group or item from `ProjectShell.tsx` fails this spec with a clear
 * "expected X visible, got null" message + screenshot.
 */
test.describe('Project shell sidebar', () => {
  test('contains every expected group + entry', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}`);

    for (const group of PROJECT_SHELL_GROUPS) {
      // Heading text rendered above the items
      await expect(
        page.getByText(group.heading, { exact: true }),
        `expected sidebar group "${group.heading}" to be visible`,
      ).toBeVisible();

      for (const item of group.items) {
        const expectedHref = `/dashboard/project/${ref}${item.suffix}`;
        await expect(
          page.getByRole('link', { name: item.label, exact: true }),
          `expected sidebar link "${item.label}" (in "${group.heading}") to be visible`,
        ).toHaveAttribute('href', expectedHref);
      }
    }
  });

  test('each sidebar link routes to a non-404 page', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}`);

    for (const group of PROJECT_SHELL_GROUPS) {
      for (const item of group.items) {
        const expectedHref = `/dashboard/project/${ref}${item.suffix}`;
        await page.getByRole('link', { name: item.label, exact: true }).click();
        await expect(page).toHaveURL(expectedHref);
        // Each project page renders with the project shell sidebar present —
        // a 404 / SPA-fallback would not. So if the next iteration's link
        // is still findable, the previous click landed on a real page.
      }
    }
  });
});
