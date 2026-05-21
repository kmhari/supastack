import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth-context.js';

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
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#eee',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <form
        onSubmit={(e) => void onSubmit(e)}
        style={{ display: 'grid', gap: 12, width: 360, padding: 32 }}
      >
        <h1>Sign in to Selfbase</h1>
        <input
          type="email"
          placeholder="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
        <input
          type="password"
          placeholder="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        {error && <div style={{ color: '#f99', fontSize: 14 }}>{error}</div>}
        <button disabled={submitting} type="submit" style={primaryButtonStyle}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid #444',
  background: '#222',
  color: '#eee',
  borderRadius: 4,
};
const primaryButtonStyle: React.CSSProperties = {
  padding: '10px 16px',
  background: '#3ECF8E',
  color: '#000',
  border: 'none',
  borderRadius: 4,
  fontWeight: 600,
  cursor: 'pointer',
};
