import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { instancesApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

interface InstanceRow {
  ref: string;
  name: string;
  status: 'provisioning' | 'running' | 'paused' | 'stopped' | 'failed' | 'deleting';
  urls: { kong: string | null; studio: string | null };
  createdAt: string;
}

export function InstancesPage(): React.ReactElement {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery<InstanceRow[]>({
    queryKey: ['instances'],
    queryFn: () => instancesApi.list() as Promise<InstanceRow[]>,
    // Auto-refetch while any row is in a transient state.
    refetchInterval: (q) => {
      const rows = (q.state.data as InstanceRow[] | undefined) ?? [];
      const transient = rows.some((r) => ['provisioning', 'deleting'].includes(r.status));
      return transient ? 3_000 : 15_000;
    },
  });

  return (
    <Shell email={user?.email ?? ''} onLogout={() => void logout()}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <h1 style={{ margin: 0 }}>Instances</h1>
        {user?.role === 'admin' && (
          <button onClick={() => navigate('/instances/new')} style={primaryButton}>
            + New Instance
          </button>
        )}
      </header>
      {isLoading && <p>Loading…</p>}
      {error && <p style={{ color: '#f99' }}>Failed to load instances</p>}
      {data && data.length === 0 && <Empty role={user?.role ?? 'member'} />}
      {data && data.length > 0 && (
        <div style={{ display: 'grid', gap: 12 }}>
          {data.map((r) => (
            <Link
              key={r.ref}
              to={`/p/${r.ref}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 16,
                padding: 16,
                background: '#161616',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                color: 'inherit',
                textDecoration: 'none',
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div style={{ fontSize: 12, color: '#888', fontFamily: 'ui-monospace, monospace' }}>
                  {r.ref}
                </div>
              </div>
              <StatusPill status={r.status} />
              <div style={{ color: '#888', fontSize: 12 }}>
                {r.urls.kong ?? '<no apex configured>'}
              </div>
            </Link>
          ))}
        </div>
      )}
    </Shell>
  );
}

function Empty({ role }: { role: string }): React.ReactElement {
  return (
    <div
      style={{ padding: 32, background: '#161616', border: '1px solid #2a2a2a', borderRadius: 6 }}
    >
      <p style={{ marginTop: 0 }}>No instances yet.</p>
      {role === 'admin' && <p>Click &quot;+ New Instance&quot; to provision your first one.</p>}
    </div>
  );
}

function StatusPill({ status }: { status: InstanceRow['status'] }): React.ReactElement {
  const colors: Record<InstanceRow['status'], { bg: string; fg: string }> = {
    provisioning: { bg: '#3a3a17', fg: '#fadc6b' },
    running: { bg: '#19402c', fg: '#3ECF8E' },
    paused: { bg: '#1f2a3a', fg: '#7ab8f5' },
    stopped: { bg: '#333', fg: '#aaa' },
    failed: { bg: '#3a1717', fg: '#ff8b8b' },
    deleting: { bg: '#2a2a2a', fg: '#888' },
  };
  const c = colors[status];
  return (
    <span
      style={{
        background: c.bg,
        color: c.fg,
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  );
}

function Shell({
  email,
  onLogout,
  children,
}: {
  email: string;
  onLogout: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0a0a',
        color: '#eee',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <nav
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid #2a2a2a',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <strong>Selfbase</strong>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 14 }}>
          <span style={{ color: '#888' }}>{email}</span>
          <button
            onClick={onLogout}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#eee',
              padding: '4px 12px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </nav>
      <main style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>{children}</main>
    </div>
  );
}

const primaryButton: React.CSSProperties = {
  padding: '10px 16px',
  background: '#3ECF8E',
  color: '#000',
  border: 'none',
  borderRadius: 4,
  fontWeight: 600,
  cursor: 'pointer',
};
