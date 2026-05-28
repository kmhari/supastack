import { test, expect } from './fixtures/admin-session';
import { testProjectRef } from './fixtures/test-project';

/**
 * US2 — Auth Providers page in a real browser.
 *
 * Spec: specs/021-dashboard-browser-tests/spec.md US2, FR-004
 * Plan: specs/021-dashboard-browser-tests/plan.md §B2
 * Task: T015 + T016 (memberContext for the RBAC test)
 *
 * These are the assertions feature 020 deferred because Radix Sheet portals
 * are unreliable in jsdom. Real Chromium handles the portal mount fine.
 */
test.describe('Auth Providers page', () => {
  test('providers list contains expected rows', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/providers`);

    // Sample 8 row names spanning each row type: toggle-only, Common-4,
    // Plus-URL, Google-specific, Apple-specific, OIDC (LinkedIn), legacy
    // Slack, OIDC Slack. Plus 2 coming-soon placeholders.
    const expectedRows = [
      'Email',
      'Phone',
      'Google',
      'GitHub',
      'Apple',
      'Azure',
      'Slack (OIDC)',
      'Slack (Deprecated)',
      'LinkedIn (OIDC)',
      'SAML 2.0',
      'Web3 Wallet',
    ];
    for (const name of expectedRows) {
      await expect(
        page.getByText(name, { exact: true }).first(),
        `expected provider row "${name}" visible`,
      ).toBeVisible();
    }
  });

  test('Google drawer opens with expected fields', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/providers`);

    // Open the Google row. The button's accessible name includes the status
    // pill text ("Google Disabled" / "Google Enabled"), so anchor with /^Google/.
    await page.getByRole('button', { name: /^Google\b/ }).first().click();

    // Drawer fields per provider-form-templates.md §4 (Google template).
    await expect(page.getByLabel('Client IDs')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByLabel('Client Secret (for OAuth)')).toBeVisible();
    await expect(page.getByLabel('Callback URL (for OAuth)')).toHaveAttribute(
      'readonly',
      '',
    );

    // Reveal button is rendered disabled (deferred to issue #73 per spec FR-016).
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeDisabled();

    // Provider-specific toggles.
    await expect(page.getByText('Skip nonce checks', { exact: true })).toBeVisible();
    await expect(page.getByText('Allow users without an email', { exact: true })).toBeVisible();
  });

  test('deep-link ?provider=Slack (OIDC) opens the OIDC drawer', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    // URL-encoded space + parens; the page reads `?provider=` and matches
    // case-insensitively against ProviderDef.displayName.
    await page.goto(
      `/dashboard/project/${ref}/auth/providers?provider=Slack%20%28OIDC%29`,
    );

    // The drawer's title is the provider's displayName — "Slack (OIDC)".
    // This distinguishes it from the legacy "Slack (Deprecated)" drawer.
    await expect(
      page.getByRole('heading', { name: 'Slack (OIDC)' }),
      'expected "Slack (OIDC)" drawer heading visible',
    ).toBeVisible({ timeout: 10_000 });
  });

  test('non-admin role hides Save buttons on Global Toggles', async ({ memberContext }) => {
    const ref = await testProjectRef();
    const page = await memberContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/providers`);

    // The Global Toggles' Save button is only rendered when isAdmin === true
    // (see GlobalTogglesForm.tsx). The label is "Save changes".
    await expect(page.getByText('Allow new users to sign up', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  });
});
