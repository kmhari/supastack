// T062 — ProjectSecrets page smoke test (RTL + jsdom).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const listMock = vi.fn();
const upsertMock = vi.fn();
const deleteMock = vi.fn();

vi.mock('@/lib/api', () => ({
  secretsApi: {
    list: (...a: unknown[]) => listMock(...a),
    upsert: (...a: unknown[]) => upsertMock(...a),
    delete: (...a: unknown[]) => deleteMock(...a),
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
}));

import { ProjectSecretsPage } from '@/pages/ProjectSecrets';

function renderPage(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard/project/abc/secrets']}>
        <Routes>
          <Route path="/dashboard/project/:ref/secrets" element={<ProjectSecretsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectSecretsPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    upsertMock.mockReset();
    deleteMock.mockReset();
    listMock.mockResolvedValue([]);
    upsertMock.mockResolvedValue(undefined);
  });
  afterEach(() => cleanup());

  it('renders headings + empty state', async () => {
    renderPage();
    expect(screen.getByText(/add or replace secrets/i)).toBeDefined();
    expect(screen.getByText(/custom secrets/i)).toBeDefined();
    await waitFor(() => expect(screen.getByText(/no custom secrets yet/i)).toBeDefined());
  });

  it('renders custom secrets list from api', async () => {
    listMock.mockResolvedValue([
      { name: 'STRIPE_KEY', value: 'sha256deadbeef0000000' },
      { name: 'OPENAI_KEY', value: 'sha256feedface0000000' },
    ]);
    renderPage();
    await waitFor(() => expect(screen.getByText('STRIPE_KEY')).toBeDefined());
    expect(screen.getByText('OPENAI_KEY')).toBeDefined();
  });

  it('save calls upsert with typed rows', async () => {
    renderPage();
    const nameInput = screen.getByPlaceholderText('SECRET_NAME') as HTMLInputElement;
    const valueInput = screen.getByPlaceholderText('value') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'API_KEY' } });
    fireEvent.change(valueInput, { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith('abc', [{ name: 'API_KEY', value: 'secret123' }]),
    );
  });

  it('paste of KEY=value auto-splits', () => {
    renderPage();
    const nameInput = screen.getByPlaceholderText('SECRET_NAME') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'FOO=bar' } });
    expect(nameInput.value).toBe('FOO');
  });
});
