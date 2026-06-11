// @vitest-environment jsdom
//
// Fresh-install wizard path (shipfan.xyz E2E, 2026-06-12): after creating the
// admin, the wizard must (a) establish a GoTrue session via authApi.login —
// feature 084 deleted the api's /auth/login and left the wizard sessionless,
// so every later call 401'd — and (b) fetch the apex before mounting the cert
// step; apexRef was only populated on the setup-already-done path, so a real
// apex rendered the "real domain is required" block.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

const login = vi.fn(async () => {});
const run = vi.fn(async () => ({ apiToken: 'sbp_test', userId: 'u', orgId: 1, email: 'a@b.co' }));

vi.mock('@/lib/api', () => ({
  setupApi: { status: vi.fn(async () => ({ open: true })), run: (...a: unknown[]) => run(...a) },
  apexApi: {
    status: vi.fn(async () => ({ apex: 'shipfan.test', cert: null })),
    recheck: vi.fn(async () => ({})),
    issue: vi.fn(async () => ({})),
  },
  wildcardCertApi: {
    initiate: vi.fn(async () => ({ challengeRecords: [] })),
    status: vi.fn(async () => ({ cert: null })),
  },
  authApi: { me: vi.fn(async () => ({})), login: (...a: unknown[]) => login(...a) },
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ refresh: vi.fn(async () => {}) }),
}));

import { SetupPage } from '../../src/pages/Setup';

afterEach(() => cleanup());

describe('setup wizard — fresh-install admin → certs handoff', () => {
  it('creates admin, logs in, and hands the REAL apex to the cert step', async () => {
    render(createElement(MemoryRouter, null, createElement(SetupPage)));

    // Step 1: admin form (fresh install).
    fireEvent.change(await screen.findByPlaceholderText('you@example.com'), {
      target: { value: 'ops@shipfan.test' },
    });
    fireEvent.change(screen.getByPlaceholderText(/••••/), { target: { value: 'hunter22222' } });
    fireEvent.change(screen.getByPlaceholderText(/your company or team name/i), {
      target: { value: 'Shipfan' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create super-admin/i }));

    // Step 2 must be the DNS step FOR THE REAL APEX — not the localhost block.
    expect(await screen.findByText(/Set up DNS for shipfan\.test/i)).toBeTruthy();
    expect(screen.queryByText(/real domain is required/i)).toBeNull();

    // And the session was established before any authed call.
    expect(login).toHaveBeenCalledWith({ email: 'ops@shipfan.test', password: 'hunter22222' });
  });
});
