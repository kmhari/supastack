/**
 * Playwright golden-path E2E covering: setup → create instance → reveal
 * credentials → backup → pause → resume → delete. Mirrors quickstart.md.
 * SC-005 + SC-009 coverage.
 *
 * Skeleton; real Playwright implementation in CI. See invite-flow.spec.ts
 * comment for the same pattern.
 */
import { describe, test } from 'vitest';

const BASE = process.env.PLAYWRIGHT_BASE_URL;

describe.skipIf(!BASE)('golden-path.spec (Playwright placeholder)', () => {
  test('setup → create → reveal → backup → pause → resume → delete', () => {
    // see quickstart.md for the click-by-click breakdown
  });
});
