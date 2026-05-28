import type { Page } from '@playwright/test';
import { CONSOLE_ERROR_ALLOWLIST } from '../expected-pages';

/**
 * Shared helpers used across spec files.
 *
 * Task: T008
 */

/**
 * Attach a console listener that collects error-level messages, filtering by
 * the allowlist from expected-pages.ts. Returns an `assert()` callable the
 * test invokes at end-of-test to fail with a clear message if anything
 * unexpected leaked.
 *
 * Usage:
 *   const consoleAssertion = expectNoConsoleErrors(page);
 *   await page.goto(...);
 *   await expect(page.getByRole('heading', { name: 'X' })).toBeVisible();
 *   consoleAssertion.assert();
 */
export function expectNoConsoleErrors(page: Page): { assert: () => void } {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (CONSOLE_ERROR_ALLOWLIST.some((re) => re.test(text))) return;
    errors.push(text);
  });
  return {
    assert(): void {
      if (errors.length > 0) {
        throw new Error(
          `Unexpected console errors on ${page.url()}:\n  - ${errors.join('\n  - ')}`,
        );
      }
    },
  };
}

/**
 * Substitute `{ref}` placeholder in an expected-page path with a real ref.
 */
export function resolvePath(path: string, ref: string): string {
  return path.replace('{ref}', ref);
}
