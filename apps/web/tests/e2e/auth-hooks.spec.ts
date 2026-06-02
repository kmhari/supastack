import { test, expect } from './fixtures/admin-session';
import { testProjectRef } from './fixtures/test-project';

/**
 * Feature 082 — Auth Hooks page in a real browser.
 *
 * Spec: specs/082-auth-hooks/spec.md US3
 * Plan: specs/082-auth-hooks/plan.md §D
 */

const HOOK_LABELS = [
  'Custom Access Token',
  'MFA Verification Attempt',
  'Password Verification Attempt',
  'Send Email',
  'Send SMS',
  'Before User Created',
  'After User Created',
] as const;

test.describe('Auth Hooks page — admin session', () => {
  test('page renders with all 7 hook sections visible', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/hooks`);

    await expect(page.getByRole('heading', { name: /^Auth Hooks$/ })).toBeVisible();

    for (const label of HOOK_LABELS) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test('admin sees enabled checkboxes that are interactive', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/hooks`);
    // Wait for the page to fully render (auth config loaded, HookForms mounted)
    await expect(page.getByRole('heading', { name: /^Auth Hooks$/ })).toBeVisible();

    // HookForm uses a native <input type="checkbox"> — use the role locator
    const checkboxes = page.locator('input[type="checkbox"]');
    await expect(checkboxes.first()).toBeVisible({ timeout: 10_000 });
    const count = await checkboxes.count();
    expect(count).toBe(7);

    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).not.toBeDisabled();
    }
  });

  test('enabling a hook reveals URI and secrets inputs', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/hooks`);

    // Enable the first hook (Custom Access Token)
    const firstCheckbox = page.locator('input[type="checkbox"]').first();
    await firstCheckbox.check();

    await expect(page.getByPlaceholder(/pg-functions:\/\/postgres\/public/).first()).toBeVisible();
    await expect(page.getByPlaceholder(/v1,whsec_/).first()).toBeVisible();
  });

  test('Save button is disabled when hook is enabled but URI is empty', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/hooks`);

    const firstCheckbox = page.locator('input[type="checkbox"]').first();
    await firstCheckbox.check();

    // URI is empty after enabling — Save should be disabled
    const saveBtn = page.getByRole('button', { name: /^Save$/ }).first();
    await expect(saveBtn).toBeDisabled();
  });

  test('Save button enabled when hook is enabled with a valid URI', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/hooks`);

    const firstCheckbox = page.locator('input[type="checkbox"]').first();
    await firstCheckbox.check();

    const uriInput = page.getByPlaceholder(/pg-functions:\/\/postgres\/public/).first();
    await uriInput.fill('pg-functions://postgres/public/my_hook');

    const saveBtn = page.getByRole('button', { name: /^Save$/ }).first();
    await expect(saveBtn).toBeEnabled();
  });

  test('hooks page is reachable from sidebar Hooks link', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}`);

    await page.getByRole('link', { name: /^Hooks$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/auth/hooks$`));
    await expect(page.getByRole('heading', { name: /^Auth Hooks$/ })).toBeVisible();
  });
});

test.describe('Auth Hooks page — member session (RBAC)', () => {
  test('member sees hooks page but all inputs are disabled', async ({ memberContext }) => {
    const ref = await testProjectRef();
    const page = await memberContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/hooks`);

    await expect(page.getByRole('heading', { name: /^Auth Hooks$/ })).toBeVisible();

    const checkboxes = page.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      await expect(checkboxes.nth(i)).toBeDisabled();
    }
  });
});
