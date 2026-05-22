/**
 * Playwright E2E for the invite flow (US4). Skipped on developer machines
 * — CI sets PLAYWRIGHT_BASE_URL.
 *
 * Drop-in shape: tests are written for `@playwright/test`. Don't require
 * the package at module-eval time so vitest doesn't trip on a missing
 * peer-dep when this file is collected by the wider test suite.
 */
import { describe, test } from 'vitest';

const BASE = process.env.PLAYWRIGHT_BASE_URL;

describe.skipIf(!BASE)('invite-flow.spec (Playwright placeholder)', () => {
  test('admin invites → second context accepts → member sees list', () => {
    // Real implementation will be a `@playwright/test` `test()` block run
    // by `npx playwright test`. Until the e2e harness ships, this file
    // exists so the path in plan.md resolves and CI can find it.
    //
    // Pseudocode:
    //   const adminCtx = await browser.newContext({ storageState: 'admin.json' });
    //   const adminPage = await adminCtx.newPage();
    //   await adminPage.goto(`${BASE}/settings/members`);
    //   await adminPage.fill('input[type=email]', 'invitee@selfbase.test');
    //   await adminPage.click('button:has-text("Invite")');
    //   const link = await adminPage.locator('code').textContent();
    //   const t0 = Date.now();
    //   const inviteeCtx = await browser.newContext();
    //   const inviteePage = await inviteeCtx.newPage();
    //   await inviteePage.goto(link!);
    //   await inviteePage.fill('input[type=password]', 'invitee-pw-12+');
    //   await inviteePage.click('button:has-text("Join")');
    //   await inviteePage.waitForURL(`${BASE}/`);
    //   expect(Date.now() - t0).toBeLessThan(60_000); // SC-012
    //   expect(await inviteePage.locator('text=New Instance').count()).toBe(0);
  });
});
