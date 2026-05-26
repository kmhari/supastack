// T060 — Login page smoke test (RTL + jsdom).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const loginMock = vi.fn(async (_e: string, _p: string) => {});

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    login: loginMock,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

import { LoginPage } from '@/pages/Login';

function renderPage(): void {
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    loginMock.mockReset();
    loginMock.mockResolvedValue(undefined);
  });
  afterEach(() => cleanup());

  it('renders the form', () => {
    renderPage();
    expect(screen.getByText(/welcome back/i)).toBeDefined();
    expect(screen.getByLabelText(/email/i)).toBeDefined();
    expect(screen.getByLabelText(/password/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeDefined();
  });

  it('submits credentials → calls auth.login', async () => {
    renderPage();
    const email = screen.getByLabelText(/email/i) as HTMLInputElement;
    const pw = screen.getByLabelText(/password/i) as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'a@b.co' } });
    fireEvent.change(pw, { target: { value: 'pw12345678' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(loginMock).toHaveBeenCalledWith('a@b.co', 'pw12345678'));
  });

  it('shows error when login rejects', async () => {
    loginMock.mockRejectedValueOnce({
      response: { data: { error: { message: 'bad creds' } } },
    });
    renderPage();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/bad creds/i)).toBeDefined());
  });
});
