// T011, T016 — ProjectAuthUrlConfig page tests (RTL + jsdom).
//
// Scope: Site URL form (admin save, member read-only, validation gates the
// Save button), and (added in T016) Add Redirect URLs dialog batch flow,
// duplicate/scheme rejection, member RBAC, dialog lifecycle invariant.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const authConfigGet = vi.fn();
const authConfigPatch = vi.fn();
const instanceGet = vi.fn();

vi.mock('@/lib/api', () => ({
  authConfigApi: {
    get: (...a: unknown[]) => authConfigGet(...a),
    patch: (...a: unknown[]) => authConfigPatch(...a),
  },
  apexApi: { status: () => Promise.resolve({ apex: 'example.com' }) },
  instancesApi: { get: (...a: unknown[]) => instanceGet(...a) },
  wildcardCertApi: { status: () => Promise.resolve({ cert: null }) },
}));

const useAuthMock = vi.fn();
vi.mock('@/lib/auth-context', () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { ProjectAuthUrlConfigPage } from '@/pages/ProjectAuthUrlConfig';

function renderAt(ref = 'abc'): void {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/dashboard/project/${ref}/auth/url-configuration`]}>
        <Routes>
          <Route
            path="/dashboard/project/:ref/auth/url-configuration"
            element={<ProjectAuthUrlConfigPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ADMIN = { id: 'u1', email: 'a@b', role: 'admin' as const };
const MEMBER = { id: 'u2', email: 'm@b', role: 'member' as const };

beforeEach(() => {
  authConfigGet.mockReset();
  authConfigPatch.mockReset();
  useAuthMock.mockReset();
  instanceGet.mockReset();
  authConfigPatch.mockResolvedValue({});
  instanceGet.mockResolvedValue({ status: 'running' });
});

afterEach(() => cleanup());

describe('ProjectAuthUrlConfigPage — Site URL section (US1)', () => {
  it('admin sees the Site URL input pre-filled and Save button disabled when clean', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({
      site_url: 'https://existing.example.com',
      uri_allow_list: '',
    });
    renderAt();
    const input = (await screen.findByLabelText('Site URL')) as HTMLInputElement;
    expect(input.value).toBe('https://existing.example.com');
    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('admin: invalid URL keeps Save button disabled', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({ site_url: '', uri_allow_list: '' });
    renderAt();
    const input = (await screen.findByLabelText('Site URL')) as HTMLInputElement;
    await userEvent.type(input, 'notaurl');
    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('admin: valid + dirty enables Save and PATCH fires with site_url', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({ site_url: '', uri_allow_list: '' });
    renderAt();
    const input = (await screen.findByLabelText('Site URL')) as HTMLInputElement;
    await userEvent.type(input, 'https://new.example.com');
    const saveBtn = screen.getByRole('button', { name: /save changes/i });
    await waitFor(() => expect((saveBtn as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(saveBtn);
    await waitFor(() =>
      expect(authConfigPatch).toHaveBeenCalledWith('abc', {
        site_url: 'https://new.example.com',
      }),
    );
  });

  it('member: input disabled, no Save button', async () => {
    useAuthMock.mockReturnValue({ user: MEMBER });
    authConfigGet.mockResolvedValue({
      site_url: 'https://existing.example.com',
      uri_allow_list: '',
    });
    renderAt();
    const input = (await screen.findByLabelText('Site URL')) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull();
  });
});

describe('ProjectAuthUrlConfigPage — Redirect URLs section (US2)', () => {
  it('empty state renders when uri_allow_list is empty', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({ site_url: '', uri_allow_list: '' });
    renderAt();
    expect(await screen.findByText('No Redirect URLs')).toBeTruthy();
    expect(screen.getByText('Auth providers may need a URL to redirect back to')).toBeTruthy();
  });

  it('existing URLs render as a list with delete buttons (admin)', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({
      site_url: '',
      uri_allow_list: 'http://localhost:3000,http://localhost:8765/**',
    });
    renderAt();
    expect(await screen.findByText('http://localhost:3000')).toBeTruthy();
    expect(screen.getByText('http://localhost:8765/**')).toBeTruthy();
    expect(screen.getByLabelText('Remove http://localhost:3000')).toBeTruthy();
  });

  it('admin: clicking Add URL opens the dialog with one row + + Add URL appends a row', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({ site_url: '', uri_allow_list: '' });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: /^Add URL$/i }));
    expect(await screen.findByText('Add new redirect URLs')).toBeTruthy();
    // One row initially → one input with placeholder
    expect(screen.getAllByPlaceholderText('https://mydomain.com').length).toBe(1);
    // Click "+ Add URL" inside the dialog
    const addBtns = screen.getAllByRole('button', { name: /^Add URL$/i });
    // First "Add URL" outside dialog opened the dialog; second one is internal
    await userEvent.click(addBtns[addBtns.length - 1]!);
    expect(screen.getAllByPlaceholderText('https://mydomain.com').length).toBe(2);
  });

  it('admin: typing a valid URL + Save URLs PATCHes the merged list', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({
      site_url: '',
      uri_allow_list: 'http://existing.example.com',
    });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: /^Add URL$/i }));
    const input = (await screen.findByPlaceholderText('https://mydomain.com')) as HTMLInputElement;
    await userEvent.type(input, 'http://localhost:8765/**');
    await userEvent.click(screen.getByRole('button', { name: /save urls/i }));
    await waitFor(() =>
      expect(authConfigPatch).toHaveBeenCalledWith('abc', {
        uri_allow_list: 'http://existing.example.com,http://localhost:8765/**',
      }),
    );
  });

  it('admin: javascript: scheme is rejected with inline error and PATCH NOT called', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({ site_url: '', uri_allow_list: '' });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: /^Add URL$/i }));
    const input = (await screen.findByPlaceholderText('https://mydomain.com')) as HTMLInputElement;
    await userEvent.type(input, 'javascript:alert(1)');
    await userEvent.click(screen.getByRole('button', { name: /save urls/i }));
    expect(await screen.findByText(/valid http\(s\) URL/i)).toBeTruthy();
    expect(authConfigPatch).not.toHaveBeenCalled();
  });

  it('admin: duplicate URL shows inline error and PATCH NOT called', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({
      site_url: '',
      uri_allow_list: 'http://localhost:3000',
    });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: /^Add URL$/i }));
    const input = (await screen.findByPlaceholderText('https://mydomain.com')) as HTMLInputElement;
    await userEvent.type(input, 'http://Localhost:3000');
    await userEvent.click(screen.getByRole('button', { name: /save urls/i }));
    expect(await screen.findByText('URL already added.')).toBeTruthy();
    expect(authConfigPatch).not.toHaveBeenCalled();
  });

  it('admin: trash on the only row removes then re-appends an empty row (dialog never shows zero rows)', async () => {
    useAuthMock.mockReturnValue({ user: ADMIN });
    authConfigGet.mockResolvedValue({ site_url: '', uri_allow_list: '' });
    renderAt();
    await userEvent.click(await screen.findByRole('button', { name: /^Add URL$/i }));
    const trash = await screen.findByRole('button', { name: /^Remove URL row$/ });
    await userEvent.click(trash);
    // Still exactly one empty input
    expect(screen.getAllByPlaceholderText('https://mydomain.com').length).toBe(1);
  });

  it('member: no Add URL button, no trash icons', async () => {
    useAuthMock.mockReturnValue({ user: MEMBER });
    authConfigGet.mockResolvedValue({
      site_url: '',
      uri_allow_list: 'http://localhost:3000',
    });
    renderAt();
    expect(await screen.findByText('http://localhost:3000')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Add URL$/i })).toBeNull();
    expect(screen.queryByLabelText('Remove http://localhost:3000')).toBeNull();
  });
});
