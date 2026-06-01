import { defineConfig } from '@playwright/test';

/**
 * Playwright config for the supastack dashboard browser-test suite.
 *
 * Spec: specs/021-dashboard-browser-tests/spec.md
 * Plan: specs/021-dashboard-browser-tests/plan.md §A2
 * Task: T003
 *
 * The reporter chain includes a custom `RedactingReporter` (T011) that
 * post-processes captured text artifacts (logs, JUnit, network panels) to
 * scrub known secret patterns before CI upload. PNG redaction is out of scope
 * for v1 (FR-009).
 */
export default defineConfig({
  testDir: './tests/e2e',
  // Each spec gets a fresh browser context via the admin-session fixture; we
  // run serially to keep state-sharing simple in v1. Parallel can land later
  // once fixtures are proven robust.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['./tests/e2e/playwright-reporter.ts'],
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: !process.env.PLAYWRIGHT_HEADED,
  },
  projects: [{ name: 'chromium', use: { channel: 'chromium' } }],
  // Per-test ceiling 60s; suite ceiling 5min (SC-003, FR-011).
  timeout: 60_000,
  globalTimeout: 5 * 60_000,
});
