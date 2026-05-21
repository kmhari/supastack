import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context.js';
import { s, theme } from '../lib/theme.js';

export function LoginPage(): React.ReactElement {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? 'invalid credentials');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={s.centeredColumn}>
      <form onSubmit={(e) => void onSubmit(e)} style={s.form}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 8,
            color: theme.color.text,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: theme.color.success,
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 16, fontWeight: theme.font.weightMedium }}>Selfbase</span>
        </div>

        <h1 style={s.formHeading}>Welcome back</h1>
        <p style={s.formSub}>Sign in to your selfbase account.</p>

        <div>
          <label style={s.label} htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={s.input}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label style={s.label} htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={s.input}
            placeholder="••••••••••••"
          />
        </div>

        {error && <div style={s.errorBox}>{error}</div>}

        <button type="submit" disabled={submitting} style={s.buttonPrimary}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>

        <div style={{ textAlign: 'center', marginTop: 4 }}>
          <span style={{ color: theme.color.textMuted, fontSize: theme.font.sizeSm }}>
            New here?{' '}
          </span>
          <a
            href="/setup"
            style={{
              color: theme.color.text,
              textDecoration: 'none',
              fontSize: theme.font.sizeSm,
              borderBottom: `1px solid ${theme.color.border}`,
            }}
          >
            Complete first-time setup →
          </a>
        </div>
      </form>
    </div>
  );
}
