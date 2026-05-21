import { useState, type FormEvent } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { instancesApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

export function InstancesNewPage(): React.ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [enableSignup, setEnableSignup] = useState(true);
  const [jwtExpirySec, setJwtExpirySec] = useState(3600);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user && user.role !== 'admin') return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        name,
        enableSignup,
        jwtExpirySec: Number(jwtExpirySec),
      };
      if (smtpHost) {
        body.smtp = { host: smtpHost, port: Number(smtpPort), user: smtpUser, password: smtpPass };
      }
      const out = (await instancesApi.create(body)) as { ref: string };
      navigate(`/p/${out.ref}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? e.message ?? 'create failed');
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
        fontFamily: 'system-ui, sans-serif',
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1>Create Instance</h1>
        <p style={{ color: '#888' }}>Provisioning takes ~60–90 seconds.</p>
        <form onSubmit={(e) => void onSubmit(e)} style={{ display: 'grid', gap: 12 }}>
          <Field label="Name">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <fieldset style={fieldsetStyle}>
            <legend style={{ padding: '0 8px', color: '#888' }}>Auth</legend>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={enableSignup}
                onChange={(e) => setEnableSignup(e.target.checked)}
              />
              Enable signup
            </label>
            <Field label="JWT expiry (seconds)">
              <input
                type="number"
                min={60}
                max={86400 * 30}
                value={jwtExpirySec}
                onChange={(e) => setJwtExpirySec(Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
          </fieldset>
          <fieldset style={fieldsetStyle}>
            <legend style={{ padding: '0 8px', color: '#888' }}>
              SMTP (optional — for invite/recovery emails)
            </legend>
            <Field label="Host">
              <input
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                style={inputStyle}
                placeholder="smtp.example.com"
              />
            </Field>
            <Field label="Port">
              <input
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="User">
              <input
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                style={inputStyle}
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                style={inputStyle}
              />
            </Field>
          </fieldset>
          {error && <div style={{ color: '#f99' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 12 }}>
            <button type="submit" disabled={submitting} style={primaryButton}>
              {submitting ? 'Creating…' : 'Create'}
            </button>
            <button type="button" onClick={() => navigate('/')} style={secondaryButton}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #444',
  background: '#222',
  color: '#eee',
  borderRadius: 4,
  width: '100%',
};
const fieldsetStyle: React.CSSProperties = {
  border: '1px solid #2a2a2a',
  borderRadius: 6,
  padding: 12,
  display: 'grid',
  gap: 12,
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
const secondaryButton: React.CSSProperties = {
  padding: '10px 16px',
  background: 'none',
  color: '#eee',
  border: '1px solid #444',
  borderRadius: 4,
  cursor: 'pointer',
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <label style={{ display: 'grid', gap: 4, fontSize: 14 }}>
      <span style={{ color: '#aaa' }}>{label}</span>
      {children}
    </label>
  );
}
