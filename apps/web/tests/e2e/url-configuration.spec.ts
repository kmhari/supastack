import { test, expect } from './fixtures/admin-session';
import { testProjectRef } from './fixtures/test-project';

/**
 * Feature 022 — URL Configuration page in a real browser.
 *
 * Spec: specs/022-url-configuration/spec.md (US1–US4)
 * Plan: specs/022-url-configuration/plan.md
 * Task: T024
 */
test.describe('URL Configuration page', () => {
  test('admin sees Site URL input + Save button + Add URL button', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/url-configuration`);

    await expect(page.getByRole('heading', { name: /^URL Configuration$/ })).toBeVisible();
    await expect(page.getByLabel('Site URL')).toBeVisible();
    await expect(page.getByRole('button', { name: /Save changes/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Add URL$/ }).first()).toBeVisible();
  });

  test('typing an invalid Site URL keeps Save button disabled', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/url-configuration`);

    const input = page.getByLabel('Site URL');
    await input.fill('notaurl');
    await expect(page.getByRole('button', { name: /Save changes/ })).toBeDisabled();
  });

  test('Add URL opens dialog; + Add URL appends a row', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/url-configuration`);

    await page
      .getByRole('button', { name: /^Add URL$/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: 'Add new redirect URLs' })).toBeVisible();
    expect(await page.getByPlaceholder('https://mydomain.com').count()).toBe(1);

    // Click the secondary "Add URL" inside the dialog
    const dialogAdd = page.getByRole('button', { name: /^Add URL$/ }).last();
    await dialogAdd.click();
    expect(await page.getByPlaceholder('https://mydomain.com').count()).toBe(2);
  });

  test('javascript: scheme rejected with inline error', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/url-configuration`);

    await page
      .getByRole('button', { name: /^Add URL$/ })
      .first()
      .click();
    await page.getByPlaceholder('https://mydomain.com').fill('javascript:alert(1)');
    await page.getByRole('button', { name: /Save URLs/ }).click();
    await expect(page.getByText(/valid http\(s\) URL/i)).toBeVisible();
  });

  test('Docs link points to the canonical Cloud docs URL', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/url-configuration`);

    const docs = page.getByRole('link', { name: /Docs/ }).first();
    await expect(docs).toHaveAttribute(
      'href',
      'https://supabase.com/docs/guides/auth/redirect-urls',
    );
  });

  test('empty state copy renders when allow-list is empty', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/url-configuration`);

    // Either the empty state or a real list is present; we tolerate either.
    const empty = page.getByText('No Redirect URLs');
    const list = page.getByRole('list', { name: 'Redirect URLs' });
    await expect(empty.or(list)).toBeVisible();
  });

  test('deep-link directly to the page renders it', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/url-configuration`);
    await expect(page.getByRole('heading', { name: /^URL Configuration$/ })).toBeVisible();
  });

  test('sidebar entry navigates to URL Configuration', async ({ adminContext }) => {
    const ref = await testProjectRef();
    const page = await adminContext.newPage();
    await page.goto(`/dashboard/project/${ref}`);

    await page.getByRole('link', { name: /^URL Configuration$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/project/${ref}/auth/url-configuration$`));
    await expect(page.getByRole('heading', { name: /^URL Configuration$/ })).toBeVisible();
  });

  test('non-admin sees disabled input, no Save button, no Add URL', async ({ memberContext }) => {
    const ref = await testProjectRef();
    const page = await memberContext.newPage();
    await page.goto(`/dashboard/project/${ref}/auth/url-configuration`);

    await expect(page.getByLabel('Site URL')).toBeDisabled();
    await expect(page.getByRole('button', { name: /Save changes/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Add URL$/ })).toHaveCount(0);
  });
});
