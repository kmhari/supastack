import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { setupApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';
import { s, theme } from '../lib/theme.js';

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

  if (open === null) {
    return (
      <div style={s.centeredColumn}>
        <span style={{ color: theme.color.textMuted }}>Loading…</span>
      </div>
    );
  }
  if (open === false && !masterToken) return <Navigate to="/login" replace />;

  if (masterToken) {
    return (
      <div style={s.centeredColumn}>
        <div style={{ ...s.form, gap: 20 }}>
          <Wordmark />
          <h1 style={s.formHeading}>Welcome to Selfbase</h1>
          <p style={s.formSub}>
            Your super-admin account is created. Save this master API token — it&apos;s shown once
            and cannot be recovered:
          </p>
          <pre
            style={{
              background: theme.color.cardBg,
              color: theme.color.success,
              padding: 14,
              borderRadius: theme.radius.md,
              border: `1px solid ${theme.color.border}`,
              overflowX: 'auto',
              fontSize: theme.font.sizeSm,
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              margin: 0,
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
            }}
          >
            {masterToken}
          </pre>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => void navigator.clipboard.writeText(masterToken)}
              style={s.buttonSecondary}
            >
              Copy token
            </button>
            <button
              onClick={() => void refresh().then(() => navigate('/'))}
              style={s.buttonPrimary}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
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
    <div style={s.centeredColumn}>
      <form onSubmit={(e) => void onSubmit(e)} style={s.form}>
        <Wordmark />
        <h1 style={s.formHeading}>First-time setup</h1>
        <p style={s.formSub}>
          Create the super-admin account for this Selfbase install. This page disappears after the
          first run.
        </p>

        <Field label="Email">
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={s.input}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password" hint="minimum 12 characters">
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={s.input}
            placeholder="••••••••••••"
          />
        </Field>
        <Field label="Organization name">
          <input
            required
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            style={s.input}
          />
        </Field>
        <Field label="Apex domain" hint="optional — you can add this later from Settings">
          <input
            value={apexDomain}
            onChange={(e) => setApexDomain(e.target.value)}
            style={s.input}
            placeholder="selfbase.example.com"
          />
        </Field>

        {error && <div style={s.errorBox}>{error}</div>}

        <button disabled={submitting} type="submit" style={s.buttonPrimary}>
          {submitting ? 'Creating…' : 'Create super-admin'}
        </button>
      </form>
    </div>
  );
}

function Wordmark(): React.ReactElement {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
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
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div>
      <label style={s.label}>{label}</label>
      {children}
      {hint && (
        <div
          style={{
            color: theme.color.textMuted,
            fontSize: theme.font.sizeXs,
            marginTop: 4,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}
