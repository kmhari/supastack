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
const apexStatus = vi.fn(async () => ({ apex: 'shipfan.test', cert: null }));
const apexInfo = vi.fn(async () => ({
  apex: 'shipfan.test',
  expectedIp: '203.0.113.7',
  cert: null,
}));
const wcStatus = vi.fn(async () => ({ cert: null }));

vi.mock('@/lib/api', () => ({
  setupApi: { status: vi.fn(async () => ({ open: true })), run: (...a: unknown[]) => run(...a) },
  apexApi: {
    status: () => apexStatus(),
    info: () => apexInfo(),
    recheck: vi.fn(async () => ({})),
    issue: vi.fn(async () => ({})),
  },
  wildcardCertApi: {
    initiate: vi.fn(async () => ({
      challengeRecords: [
        { name: '_acme-challenge', value: 'txt-value-1' },
        { name: '_acme-challenge', value: 'txt-value-2' },
      ],
    })),
    status: () => wcStatus(),
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

  // Negative-cache guard: querying DNS before the operator has added the
  // records gets NXDOMAIN cached at the public resolvers for the zone's
  // negative TTL — the "records added but wizard won't confirm" stall from
  // the shipfan.xyz install. The wizard must not fire a single DNS-probing
  // call until the operator clicks "All 4 records added", and then only
  // after a 10s propagation grace.
  it('does not probe DNS until the operator confirms the records (then 10s grace)', async () => {
    render(createElement(MemoryRouter, null, createElement(SetupPage)));

    fireEvent.change(await screen.findByPlaceholderText('you@example.com'), {
      target: { value: 'ops@shipfan.test' },
    });
    fireEvent.change(screen.getByPlaceholderText(/••••/), { target: { value: 'hunter22222' } });
    fireEvent.change(screen.getByPlaceholderText(/your company or team name/i), {
      target: { value: 'Shipfan' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create super-admin/i }));

    const confirmBtn = await screen.findByRole('button', { name: /all 4 records added/i });

    // Records state: zero probing calls so far — only the no-probe info().
    expect(apexStatus).not.toHaveBeenCalled();
    expect(wcStatus).not.toHaveBeenCalled();
    expect(apexInfo).toHaveBeenCalled();

    vi.useFakeTimers();
    try {
      fireEvent.click(confirmBtn);
      // Propagation grace: loader shown, still no probing.
      expect(screen.getByText(/waiting for dns propagation/i)).toBeTruthy();
      expect(apexStatus).not.toHaveBeenCalled();

      // After the 10s grace the verification poll starts.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(apexStatus).toHaveBeenCalled();
      expect(wcStatus).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
