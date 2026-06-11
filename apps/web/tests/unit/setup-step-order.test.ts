// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://shipfan.test/setup" }
//
// Cert-first setup ordering: DNS + wildcard cert is STEP 1, admin-account
// creation is STEP 2 — so the admin password is submitted over HTTPS on the
// real domain, never plain http://<ip>. Locks the bootstrap routing:
//   open + real apex + no cert   → domain-certs step
//   open + real apex + cert + on-apex host → admin step (empty org name)
//   open + local apex            → admin step (cert step impossible locally)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';

const apexStatus = vi.fn();

vi.mock('@/lib/api', () => ({
  setupApi: { status: vi.fn(async () => ({ open: true })), run: vi.fn() },
  apexApi: {
    status: (...a: unknown[]) => apexStatus(...a),
    recheck: vi.fn(async () => ({})),
    issue: vi.fn(async () => ({})),
  },
  wildcardCertApi: {
    initiate: vi.fn(async () => ({ challengeRecords: [] })),
    status: vi.fn(async () => ({ cert: null })),
  },
  authApi: { me: vi.fn(async () => ({})) },
}));
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ refresh: vi.fn(async () => {}) }),
}));

import { SetupPage } from '../../src/pages/Setup';

const renderPage = () => render(createElement(MemoryRouter, null, createElement(SetupPage)));

afterEach(() => cleanup());

describe('setup wizard — cert-first step order', () => {
  it('setup open + real apex + cert not issued → DNS step first, no account form', async () => {
    apexStatus.mockResolvedValue({ apex: 'shipfan.test', cert: null });
    renderPage();
    expect(await screen.findByText(/Set up DNS for shipfan\.test/i)).toBeTruthy();
    expect(screen.queryByText(/create the super-admin/i)).toBeNull();
  });

  it('setup open + cert issued + on the apex host → admin step (over HTTPS)', async () => {
    apexStatus.mockResolvedValue({ apex: 'shipfan.test', cert: { issued: true } });
    renderPage();
    expect(await screen.findByText(/create the super-admin/i)).toBeTruthy();
    // Org name must NOT be prefilled with the product name.
    const org = screen.getByPlaceholderText(/your company or team name/i) as HTMLInputElement;
    expect(org.value).toBe('');
  });

  it('setup open + local apex → admin step directly (no cert step possible)', async () => {
    apexStatus.mockResolvedValue({ apex: 'localhost', cert: null });
    renderPage();
    expect(await screen.findByText(/create the super-admin/i)).toBeTruthy();
  });
});
