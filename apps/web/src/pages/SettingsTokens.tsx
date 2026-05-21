import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { authApi } from '../lib/api.js';

interface Token {
  id: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export function SettingsTokensPage(): React.ReactElement {
  const qc = useQueryClient();
  const { data: tokens = [], isLoading } = useQuery<Token[]>({
    queryKey: ['tokens'],
    queryFn: () => authApi.listTokens() as Promise<Token[]>,
  });

  const [label, setLabel] = useState('');
  const [newToken, setNewToken] = useState<{ id: string; token: string; label: string } | null>(
    null,
  );

  const create = useMutation({
    mutationFn: (body: { label: string }) => authApi.createToken(body),
    onSuccess: (data) => {
      setNewToken(data as { id: string; token: string; label: string });
      setLabel('');
      qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeToken(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tokens'] }),
  });

  const onCreate = (e: FormEvent): void => {
    e.preventDefault();
    if (!label.trim()) return;
    setNewToken(null);
    create.mutate({ label });
  };

  return (
    <div style={shell}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link to="/" style={linkButton}>
          ← Instances
        </Link>
        <h1 style={{ marginTop: 12 }}>API tokens</h1>
        <p style={{ color: '#888' }}>
          Personal bearer tokens for CLI / scripts. Treat like a password.
        </p>

        <section style={card}>
          <h2 style={h2}>Create token</h2>
          <form onSubmit={onCreate} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <Field label="Label (e.g. 'ci-deploy')">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                style={{ ...inputStyle, minWidth: 240 }}
                placeholder="ci-deploy"
              />
            </Field>
            <button type="submit" disabled={create.isPending} style={primaryButton}>
              {create.isPending ? 'Creating…' : 'Create'}
            </button>
          </form>
          {newToken && (
            <div style={{ marginTop: 12, padding: 12, background: '#0a0a0a', borderRadius: 4 }}>
              <p style={{ margin: 0, fontSize: 13, color: '#fadc6b' }}>
                Save this token — it&apos;s shown once and never again:
              </p>
              <code
                style={{ display: 'block', marginTop: 8, wordBreak: 'break-all', color: '#3ECF8E' }}
              >
                {newToken.token}
              </code>
              <button
                onClick={() => void navigator.clipboard.writeText(newToken.token)}
                style={{ ...secondaryButton, marginTop: 8 }}
              >
                Copy token
              </button>
            </div>
          )}
        </section>

        <section style={card}>
          <h2 style={h2}>Your tokens ({tokens.length})</h2>
          {isLoading ? (
            <p>Loading…</p>
          ) : tokens.length === 0 ? (
            <p style={{ color: '#888' }}>No tokens yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#888' }}>
                  <th style={th}>Label</th>
                  <th style={th}>Created</th>
                  <th style={th}>Last used</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid #2a2a2a' }}>
                    <td style={td}>{t.label}</td>
                    <td style={td}>{new Date(t.createdAt).toLocaleDateString()}</td>
                    <td style={td}>
                      {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}
                    </td>
                    <td style={td}>
                      <button
                        onClick={() => {
                          if (confirm(`Revoke token "${t.label}"? Cannot be undone.`))
                            revoke.mutate(t.id);
                        }}
                        style={{ ...linkButton, color: '#f99' }}
                      >
                        Revoke
                      </button>
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

const shell: React.CSSProperties = {
  minHeight: '100vh',
  background: '#0a0a0a',
  color: '#eee',
  fontFamily: 'system-ui, sans-serif',
  padding: 32,
};
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
  padding: '8px 10px',
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
  textDecoration: 'none',
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
