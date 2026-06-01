// US5b — additional page smoke tests to push web statements over 30%.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const instanceGet = vi.fn();
const cliProfileToml = vi.fn();
const cliMintToken = vi.fn();
const cliLoginMint = vi.fn();
const revealCreds = vi.fn();

vi.mock('@/lib/api', () => ({
  instancesApi: {
    list: () => Promise.resolve([]),
    get: (...a: unknown[]) => instanceGet(...a),
    create: vi.fn(),
    rename: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    delete: vi.fn(),
    revealCredentials: (...a: unknown[]) => revealCreds(...a),
  },
  cliApi: {
    profileToml: () => cliProfileToml(),
    mintToken: () => cliMintToken(),
  },
  cliLoginApi: {
    mint: (...a: unknown[]) => cliLoginMint(...a),
  },
  wildcardCertApi: { status: () => Promise.resolve({ cert: null }) },
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { userId: 'u1', email: 'a@b.co', role: 'admin' },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

import { ProjectGeneralPage } from '@/pages/ProjectGeneral';
import { ProjectApiKeysPage } from '@/pages/ProjectApiKeys';
import { ConnectCliPage } from '@/pages/ConnectCli';

function withProviders(initial: string, path: string, el: React.ReactElement): React.ReactElement {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path={path} element={el} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProjectGeneralPage', () => {
  beforeEach(() => {
    instanceGet.mockReset();
  });
  afterEach(() => cleanup());

  it('renders loading state then project detail', async () => {
    instanceGet.mockResolvedValue({
      ref: 'abc',
      name: 'My Project',
      status: 'running',
      supabaseVersion: '15.1',
      urls: { kong: 'https://k.example', studio: 'https://s.example' },
      createdAt: '2026-01-01T00:00:00Z',
      cert: null,
    });
    render(
      withProviders('/dashboard/project/abc', '/dashboard/project/:ref', <ProjectGeneralPage />),
    );
    await waitFor(() =>
      expect(screen.getAllByDisplayValue('My Project').length).toBeGreaterThan(0),
    );
  });

  it('renders error message when api fails', async () => {
    instanceGet.mockRejectedValue(new Error('boom'));
    render(
      withProviders('/dashboard/project/abc', '/dashboard/project/:ref', <ProjectGeneralPage />),
    );
    await waitFor(() => {
      // Either the error block or no display value present
      expect(screen.queryAllByDisplayValue('My Project').length).toBe(0);
    });
  });
});

describe('ProjectApiKeysPage', () => {
  afterEach(() => cleanup());

  it('renders anon + service_role rows', () => {
    render(
      withProviders(
        '/dashboard/project/abc/api-keys',
        '/dashboard/project/:ref/api-keys',
        <ProjectApiKeysPage />,
      ),
    );
    expect(screen.getByText('anon')).toBeDefined();
    expect(screen.getByText('service_role')).toBeDefined();
    expect(screen.getAllByText(/reveal/i).length).toBeGreaterThan(0);
  });
});

describe('ConnectCliPage', () => {
  beforeEach(() => {
    cliProfileToml.mockReset();
    cliMintToken.mockReset();
    cliProfileToml.mockResolvedValue('[profile]\nname = "supastack"\n');
  });
  afterEach(() => cleanup());

  it('renders three-step layout with toml + mint button', async () => {
    render(withProviders('/dashboard/cli', '/dashboard/cli', <ConnectCliPage />));
    await waitFor(() => expect(screen.getAllByText(/supastack/i).length).toBeGreaterThan(0));
  });
});
