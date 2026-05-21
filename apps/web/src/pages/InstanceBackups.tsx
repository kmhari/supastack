import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { backupsApi, instancesApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

interface BackupRow {
  id: string;
  kind: 'manual' | 'auto';
  status: 'running' | 'completed' | 'failed';
  storeKind: 'local' | 's3';
  sizeBytes: number | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  downloadUrl: string | null;
}

export function InstanceBackupsPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const { data: backups = [], isLoading } = useQuery<BackupRow[]>({
    queryKey: ['instance-backups', ref],
    queryFn: () => backupsApi.list(ref) as Promise<BackupRow[]>,
    refetchInterval: (q) => {
      const rows = (q.state.data as BackupRow[] | undefined) ?? [];
      return rows.some((r) => r.status === 'running') ? 3_000 : 30_000;
    },
  });

  const { data: instance } = useQuery<{
    backupAutoEnabled: boolean;
    backupRetain: number;
    name: string;
  }>({
    queryKey: ['instances', ref],
    queryFn: () => instancesApi.get(ref) as Promise<never>,
  });

  const createBackup = useMutation({
    mutationFn: () => backupsApi.create(ref),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instance-backups', ref] }),
  });

  const [autoOn, setAutoOn] = useState<boolean | null>(null);
  const [retain, setRetain] = useState<number | null>(null);
  const effectiveAuto = autoOn ?? instance?.backupAutoEnabled ?? true;
  const effectiveRetain = retain ?? instance?.backupRetain ?? 7;

  const saveConfig = useMutation({
    mutationFn: () =>
      instancesApi.patch(ref, { backupAutoEnabled: effectiveAuto, backupRetain: effectiveRetain }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances', ref] }),
  });

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
        <Link to={`/p/${ref}`} style={linkButton}>
          ← {instance?.name ?? ref}
        </Link>
        <h1 style={{ marginTop: 12 }}>Backups</h1>

        {isAdmin && (
          <section style={card}>
            <h2 style={h2}>Auto-backup config</h2>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
              <input
                type="checkbox"
                checked={effectiveAuto}
                onChange={(e) => setAutoOn(e.target.checked)}
              />
              Daily auto-backup
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
              Retain last
              <input
                type="number"
                min={1}
                max={365}
                value={effectiveRetain}
                onChange={(e) => setRetain(Number(e.target.value))}
                style={{ ...inputStyle, width: 80 }}
              />
              backups
            </label>
            <button
              style={primaryButton}
              onClick={() => saveConfig.mutate()}
              disabled={saveConfig.isPending}
            >
              {saveConfig.isPending ? 'Saving…' : 'Save'}
            </button>
          </section>
        )}

        <section style={card}>
          <header
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <h2 style={h2}>Backup history</h2>
            {isAdmin && (
              <button
                onClick={() => createBackup.mutate()}
                disabled={createBackup.isPending}
                style={primaryButton}
              >
                {createBackup.isPending ? 'Creating…' : 'Create backup'}
              </button>
            )}
          </header>
          {isLoading ? (
            <p>Loading…</p>
          ) : backups.length === 0 ? (
            <p style={{ color: '#888' }}>No backups yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#888' }}>
                  <th style={th}>When</th>
                  <th style={th}>Kind</th>
                  <th style={th}>Status</th>
                  <th style={th}>Size</th>
                  <th style={th}>Store</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.id} style={{ borderTop: '1px solid #2a2a2a' }}>
                    <td style={td}>{new Date(b.startedAt).toLocaleString()}</td>
                    <td style={td}>{b.kind}</td>
                    <td style={td}>
                      <span style={statusColor(b.status)}>{b.status}</span>
                      {b.error && (
                        <div style={{ fontSize: 11, color: '#f99', marginTop: 4 }}>{b.error}</div>
                      )}
                    </td>
                    <td style={td}>{b.sizeBytes ? formatBytes(b.sizeBytes) : '—'}</td>
                    <td style={td}>{b.storeKind}</td>
                    <td style={td}>
                      {b.downloadUrl && (
                        <a href={b.downloadUrl} style={linkButton}>
                          Download ↓
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const statusColor = (s: BackupRow['status']): React.CSSProperties => ({
  color: s === 'completed' ? '#3ECF8E' : s === 'failed' ? '#f99' : '#fadc6b',
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
});

const card: React.CSSProperties = {
  background: '#161616',
  border: '1px solid #2a2a2a',
  borderRadius: 6,
  padding: 16,
  marginTop: 24,
};
const h2: React.CSSProperties = { margin: '0 0 12px 0', fontSize: 16 };
const th: React.CSSProperties = { padding: '8px 4px', fontWeight: 600, fontSize: 13 };
const td: React.CSSProperties = { padding: '8px 4px', fontSize: 14 };
const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid #444',
  background: '#222',
  color: '#eee',
  borderRadius: 4,
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
const linkButton: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#7ab8f5',
  cursor: 'pointer',
  padding: 0,
  fontSize: 13,
  textDecoration: 'none',
};
