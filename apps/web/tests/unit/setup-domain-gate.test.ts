// @vitest-environment jsdom
//
// Feature 117 (US1) — the setup wizard's domain step NEVER asks for the apex
// (it is the env-established single source). It guides DNS for a real domain,
// and blocks on a local/default domain. Asserts: (a) no domain-entry field, and
// (b) the blocking state on localhost.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { DomainCertsStep } from '../../src/pages/Setup';

// Mock the API surface the step touches (mount initiate + the dns poll).
vi.mock('@/lib/api', () => ({
  apexApi: {
    status: vi.fn(async () => ({
      apex: 'supaviser.dev',
      expectedIp: '1.2.3.4',
      dnsResolved: false,
      wildcardResolved: false,
      httpsReachable: false,
      cert: null,
    })),
    recheck: vi.fn(async () => ({})),
    issue: vi.fn(async () => ({})),
  },
  wildcardCertApi: {
    initiate: vi.fn(async () => ({ challengeRecords: [] })),
    status: vi.fn(async () => ({ cert: null })),
  },
  // re-exported types are erased at runtime; provide stubs so the import resolves.
  authApi: {},
  setupApi: {},
}));

afterEach(() => cleanup());

describe('DomainCertsStep — single-source apex (feature 117)', () => {
  it('established real domain → DNS step, NO domain-entry input', async () => {
    render(createElement(DomainCertsStep, { initialApex: 'supaviser.dev', onDone: () => {} }));
    // It guides DNS for the established domain…
    expect(await screen.findByText(/Set up DNS for supaviser\.dev/i)).toBeTruthy();
    // …and never renders a domain-entry textbox.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('local/default domain (localhost) → blocking message, NO input', () => {
    render(createElement(DomainCertsStep, { initialApex: 'localhost', onDone: () => {} }));
    expect(screen.getByText(/real domain is required/i)).toBeTruthy();
    expect(screen.getByText(/re-run the installer/i)).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
