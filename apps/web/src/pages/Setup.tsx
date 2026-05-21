import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { setupApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

export function SetupPage(): React.ReactElement {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [open, setOpen] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('Selfbase');
  const [apexDomain, setApexDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterToken, setMasterToken] = useState<string | null>(null);

  useEffect(() => {
    setupApi
      .status()
      .then((r) => setOpen(r.open))
      .catch(() => setOpen(false));
  }, []);

  if (open === null) return <Centered>Loading…</Centered>;
  if (open === false && !masterToken) return <Navigate to="/login" replace />;

  if (masterToken) {
    return (
      <Centered>
        <h1>Welcome to Selfbase</h1>
        <p>
          Your super-admin account is created. Save this master API token — it&apos;s shown once:
        </p>
        <pre
          style={{
            background: '#111',
            color: '#eee',
            padding: 16,
            borderRadius: 6,
            overflowX: 'auto',
          }}
        >
          {masterToken}
        </pre>
        <button onClick={() => void refresh().then(() => navigate('/'))}>
          Continue to dashboard
        </button>
      </Centered>
    );
  }

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const out = await setupApi.run({
        email,
        password,
        orgName,
        apexDomain: apexDomain.trim() || undefined,
      });
      setMasterToken(out.apiToken);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? e.message ?? 'setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Centered>
      <h1>First-time setup</h1>
      <p>
        Create the super-admin account for this Selfbase install. This page disappears after the
        first run.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
        <Field label="Email">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Password (min 12 chars)">
          <input
            type="password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Organization name">
          <input
            required
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Apex domain (optional, e.g. selfbase.example.com)">
          <input
            value={apexDomain}
            onChange={(e) => setApexDomain(e.target.value)}
            style={inputStyle}
            placeholder="leave blank to set later"
          />
        </Field>
        {error && <div style={errorStyle}>{error}</div>}
        <button disabled={submitting} type="submit" style={primaryButtonStyle}>
          {submitting ? 'Creating…' : 'Create super-admin'}
        </button>
      </form>
    </Centered>
  );
}

// Tiny inline styles to ship without committing to the theme until Phase 3.5.
const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #444',
  background: '#222',
  color: '#eee',
  borderRadius: 4,
  font: 'inherit',
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
const errorStyle: React.CSSProperties = {
  background: '#5a1a1a',
  color: '#f9d',
  padding: 8,
  borderRadius: 4,
  fontSize: 14,
};

function Field({ label, children }: { label: string; children: ReactNode }): React.ReactElement {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 14 }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      {children}
    </label>
  );
}

function Centered({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#eee',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        justifyContent: 'center',
        padding: 48,
      }}
    >
      <div style={{ maxWidth: 640, width: '100%' }}>{children}</div>
    </div>
  );
}

import type { ReactNode } from 'react';
