// T061 — Instances page smoke test (RTL + jsdom).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listMock = vi.fn();

vi.mock('@/lib/api', () => ({
  instancesApi: { list: () => listMock() },
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

import { InstancesPage } from '@/pages/Instances';

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InstancesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InstancesPage', () => {
  beforeEach(() => {
    listMock.mockReset();
  });
  afterEach(() => cleanup());

  it('renders empty state when no projects', async () => {
    listMock.mockResolvedValue([]);
    renderPage();
    await waitFor(() => expect(screen.getByText(/create a project/i)).toBeDefined());
  });

  it('renders rows from api', async () => {
    listMock.mockResolvedValue([
      {
        ref: 'abc123',
        name: 'My Project',
        status: 'running',
        supabaseVersion: '15.1',
        urls: { kong: 'https://k', studio: 'https://s' },
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        ref: 'xyz789',
        name: 'Second',
        status: 'paused',
        urls: { kong: null, studio: null },
        createdAt: '2026-02-01T00:00:00Z',
      },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('My Project')).toBeDefined());
    expect(screen.getByText('Second')).toBeDefined();
    expect(screen.getByRole('button', { name: /new project/i })).toBeDefined();
  });

  it('renders failure message on error', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/failed to load projects/i)).toBeDefined());
  });
});
