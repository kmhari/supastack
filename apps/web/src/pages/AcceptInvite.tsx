import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { membersApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

export function AcceptInvitePage(): React.ReactElement {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!token) {
      setError('missing token');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await membersApi.acceptInvite({ token, password });
      await refresh();
      navigate('/');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? e.message ?? 'accept failed');
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
        <h1>Accept invite</h1>
        <p style={{ color: '#aaa', fontSize: 14, margin: 0 }}>
          Set your password to join the organization.
        </p>
        <input
          type="password"
          placeholder="new password (min 12 chars)"
          required
          minLength={12}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        {error && <div style={{ color: '#f99', fontSize: 14 }}>{error}</div>}
        <button disabled={submitting} type="submit" style={primaryButton}>
          {submitting ? 'Joining…' : 'Join'}
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
const primaryButton: React.CSSProperties = {
  padding: '10px 16px',
  background: '#3ECF8E',
  color: '#000',
  border: 'none',
  borderRadius: 4,
  fontWeight: 600,
  cursor: 'pointer',
};
