import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { auditApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

interface AuditEntry {
  id: number;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function SettingsAuditPage(): React.ReactElement {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<{ entries: AuditEntry[]; nextCursor: string | null }>({
    queryKey: ['audit'],
    queryFn: () =>
      auditApi.list({ limit: '100' }) as Promise<{
        entries: AuditEntry[];
        nextCursor: string | null;
      }>,
    enabled: user?.role === 'admin',
    refetchInterval: 15_000,
  });

  if (user?.role !== 'admin') {
    return (
      <div style={shell}>
        <p>Audit log is admin-only.</p>
        <Link to="/" style={linkButton}>
          ← Back
        </Link>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Link to="/" style={linkButton}>
          ← Instances
        </Link>
        <h1 style={{ marginTop: 12 }}>Audit log</h1>
        <p style={{ color: '#888' }}>
          Destructive and security-sensitive actions across the org. Newest first.
        </p>
        {isLoading ? (
          <p>Loading…</p>
        ) : !data?.entries?.length ? (
          <p style={{ color: '#888' }}>No audit entries yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#888' }}>
                <th style={th}>When</th>
                <th style={th}>Actor</th>
                <th style={th}>Action</th>
                <th style={th}>Target</th>
                <th style={th}>Payload</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid #2a2a2a' }}>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td style={td}>
                    {e.actorEmail ?? <em style={{ color: '#666' }}>system/deleted</em>}
                  </td>
                  <td style={{ ...td, fontFamily: 'ui-monospace, monospace' }}>{e.action}</td>
                  <td style={td}>
                    {e.targetKind ?? '—'}
                    {e.targetId && <div style={{ fontSize: 11, color: '#888' }}>{e.targetId}</div>}
                  </td>
                  <td style={td}>
                    {Object.keys(e.payload).length > 0 && (
                      <code style={{ fontSize: 11, color: '#aaa' }}>
                        {JSON.stringify(e.payload)}
                      </code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const shell: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0a0a0a',
  color: '#eee',
  fontFamily: 'system-ui, sans-serif',
  padding: 32,
};
const th: React.CSSProperties = { padding: '8px 4px', fontWeight: 600, fontSize: 12 };
const td: React.CSSProperties = { padding: '8px 4px', fontSize: 13, verticalAlign: 'top' };
const linkButton: React.CSSProperties = { color: '#7ab8f5', textDecoration: 'none', fontSize: 13 };
