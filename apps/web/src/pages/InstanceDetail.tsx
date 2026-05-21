import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { instancesApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

interface InstanceDetail {
  ref: string;
  name: string;
  status: string;
  supabaseVersion: string;
  urls: { kong: string | null; studio: string | null };
  ports?: Record<string, number>;
  provisionError?: string | null;
  createdAt: string;
}

interface Credentials {
  ref: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
  postgresPassword: string;
  dashboardPassword: string;
  connectionStrings: Record<string, string>;
}

export function InstanceDetailPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const { data, isLoading, error } = useQuery<InstanceDetail>({
    queryKey: ['instances', ref],
    queryFn: () => instancesApi.get(ref) as Promise<InstanceDetail>,
    refetchInterval: (q) => {
      const status = (q.state.data as InstanceDetail | undefined)?.status;
      return status && ['provisioning', 'deleting'].includes(status) ? 3_000 : 15_000;
    },
  });

  const lifecycleMutation = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'restart' | 'delete') => {
      if (action === 'delete') return instancesApi.delete(ref);
      return (instancesApi[action] as (r: string) => Promise<unknown>)(ref);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });

  const [revealOpen, setRevealOpen] = useState(false);
  const [revealPassword, setRevealPassword] = useState('');
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const doReveal = async (): Promise<void> => {
    setRevealError(null);
    try {
      const out = (await instancesApi.reveal(ref, { password: revealPassword })) as Credentials;
      setCreds(out);
      setRevealOpen(false);
      setRevealPassword('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setRevealError(e.response?.data?.error?.message ?? 'reveal failed');
    }
  };

  if (isLoading) return <Centered>Loading…</Centered>;
  if (error || !data) return <Centered>Failed to load instance.</Centered>;

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
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => navigate('/')} style={linkButton}>
            ← All instances
          </button>
          <button onClick={() => navigate(`/p/${ref}/backups`)} style={linkButton}>
            Backups →
          </button>
        </div>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            marginTop: 16,
          }}
        >
          <div>
            <h1 style={{ margin: 0 }}>{data.name}</h1>
            <code style={{ fontSize: 12, color: '#888' }}>{data.ref}</code>
          </div>
          <span style={{ ...pill(data.status), padding: '4px 10px', borderRadius: 999 }}>
            {data.status}
          </span>
        </header>

        {data.provisionError && (
          <div
            style={{
              background: '#3a1717',
              color: '#ffbcbc',
              padding: 12,
              borderRadius: 6,
              marginTop: 16,
            }}
          >
            Provision failed: {data.provisionError}
          </div>
        )}

        <Section title="URLs">
          {data.urls.kong ? (
            <>
              <Row label="API">
                <code>{data.urls.kong}</code>
              </Row>
              <Row label="Studio">
                <a
                  href={`${data.urls.kong}/studio/project/default`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Studio ↗
                </a>
              </Row>
            </>
          ) : (
            <p style={{ color: '#888' }}>Set an apex domain on the org to expose URLs.</p>
          )}
        </Section>

        <Section title="Credentials">
          {!creds && (
            <>
              <button onClick={() => setRevealOpen(true)} style={primaryButton}>
                Reveal credentials
              </button>
              <p style={{ color: '#888', fontSize: 13, marginTop: 8 }}>
                Secrets are hidden by default. Revealing requires re-entering your password and is
                recorded in the audit log.
              </p>
            </>
          )}
          {creds && (
            <div style={{ display: 'grid', gap: 8 }}>
              <Reveal label="anon_key" value={creds.anonKey} />
              <Reveal label="service_role_key" value={creds.serviceRoleKey} secret />
              <Reveal label="jwt_secret" value={creds.jwtSecret} secret />
              <Reveal label="postgres_password" value={creds.postgresPassword} secret />
              <Reveal label="dashboard_password" value={creds.dashboardPassword} secret />
            </div>
          )}
        </Section>

        {isAdmin && (
          <Section title="Lifecycle">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={() => lifecycleMutation.mutate('pause')}
                disabled={data.status !== 'running'}
                style={secondaryButton}
              >
                Pause
              </button>
              <button
                onClick={() => lifecycleMutation.mutate('resume')}
                disabled={data.status !== 'paused'}
                style={secondaryButton}
              >
                Resume
              </button>
              <button
                onClick={() => lifecycleMutation.mutate('restart')}
                disabled={!['running', 'stopped'].includes(data.status)}
                style={secondaryButton}
              >
                Restart
              </button>
              <button
                onClick={() => {
                  if (
                    confirm(`Permanently delete instance "${data.name}"? This destroys all data.`)
                  ) {
                    lifecycleMutation.mutate('delete');
                  }
                }}
                style={{ ...secondaryButton, color: '#f99', borderColor: '#5a1a1a' }}
              >
                Delete
              </button>
            </div>
          </Section>
        )}

        {revealOpen && (
          <Modal onClose={() => setRevealOpen(false)} title="Re-authenticate">
            <input
              type="password"
              placeholder="your password"
              value={revealPassword}
              onChange={(e) => setRevealPassword(e.target.value)}
              style={inputStyle}
            />
            {revealError && <div style={{ color: '#f99', marginTop: 8 }}>{revealError}</div>}
            <button onClick={() => void doReveal()} style={{ ...primaryButton, marginTop: 12 }}>
              Reveal
            </button>
          </Modal>
        )}
      </div>
    </div>
  );
}

// ─── styles + tiny components ──────────────────────────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section
      style={{
        marginTop: 24,
        padding: 16,
        background: '#161616',
        border: '1px solid #2a2a2a',
        borderRadius: 6,
      }}
    >
      <h2 style={{ margin: '0 0 12px 0', fontSize: 16 }}>{title}</h2>
      {children}
    </section>
  );
}
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, padding: '4px 0' }}>
      <span style={{ color: '#888' }}>{label}</span>
      <div>{children}</div>
    </div>
  );
}
function Reveal({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}): React.ReactElement {
  const [shown, setShown] = useState(!secret);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 1fr auto auto',
        gap: 8,
        alignItems: 'center',
      }}
    >
      <span style={{ color: '#888', fontSize: 13 }}>{label}</span>
      <code
        style={{
          background: '#0a0a0a',
          padding: 6,
          borderRadius: 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {shown ? value : '••••••••••••'}
      </code>
      {secret && (
        <button onClick={() => setShown((v) => !v)} style={linkButton}>
          {shown ? 'Hide' : 'Show'}
        </button>
      )}
      <button onClick={() => void navigator.clipboard.writeText(value)} style={linkButton}>
        Copy
      </button>
    </div>
  );
}
function Modal({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}): React.ReactElement {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#161616',
          border: '1px solid #2a2a2a',
          borderRadius: 6,
          padding: 24,
          minWidth: 320,
        }}
      >
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}
function Centered({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#0a0a0a',
        color: '#eee',
      }}
    >
      {children}
    </div>
  );
}
function pill(status: string): React.CSSProperties {
  const colors: Record<string, { bg: string; fg: string }> = {
    provisioning: { bg: '#3a3a17', fg: '#fadc6b' },
    running: { bg: '#19402c', fg: '#3ECF8E' },
    paused: { bg: '#1f2a3a', fg: '#7ab8f5' },
    stopped: { bg: '#333', fg: '#aaa' },
    failed: { bg: '#3a1717', fg: '#ff8b8b' },
    deleting: { bg: '#2a2a2a', fg: '#888' },
  };
  const c = colors[status] ?? colors.stopped!;
  return {
    background: c.bg,
    color: c.fg,
    fontSize: 12,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  };
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #444',
  background: '#222',
  color: '#eee',
  borderRadius: 4,
  width: '100%',
};
const primaryButton: React.CSSProperties = {
  padding: '8px 14px',
  background: '#3ECF8E',
  color: '#000',
  border: 'none',
  borderRadius: 4,
  fontWeight: 600,
  cursor: 'pointer',
};
const secondaryButton: React.CSSProperties = {
  padding: '6px 12px',
  background: 'none',
  color: '#eee',
  border: '1px solid #444',
  borderRadius: 4,
  cursor: 'pointer',
};
const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#7ab8f5',
  cursor: 'pointer',
  padding: 0,
  fontSize: 13,
};
