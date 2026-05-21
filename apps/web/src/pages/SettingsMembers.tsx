import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { membersApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

interface Member {
  userId: string;
  email: string;
  role: 'admin' | 'member';
  createdAt: string;
}

interface Invite {
  id: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
}

interface InviteCreated {
  id: string;
  email: string;
  role: 'admin' | 'member';
  link: string;
  expiresAt: string;
}

export function SettingsMembersPage(): React.ReactElement {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const { data: members = [], isLoading } = useQuery<Member[]>({
    queryKey: ['members'],
    queryFn: () => membersApi.list() as Promise<Member[]>,
  });
  const { data: invites = [] } = useQuery<Invite[]>({
    queryKey: ['invites'],
    queryFn: () => membersApi.listInvites() as Promise<Invite[]>,
    enabled: isAdmin,
  });

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [newLink, setNewLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const createInvite = useMutation({
    mutationFn: (body: { email: string; role: 'admin' | 'member' }) =>
      membersApi.invite(body) as Promise<InviteCreated>,
    onSuccess: (data) => {
      setNewLink(data.link);
      setEmail('');
      qc.invalidateQueries({ queryKey: ['invites'] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      setInviteError(e.response?.data?.error?.message ?? 'invite failed');
    },
  });

  const revokeInvite = useMutation({
    mutationFn: (id: string) => membersApi.revokeInvite(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => membersApi.remove(userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members'] }),
  });

  const onInvite = (e: FormEvent): void => {
    e.preventDefault();
    setInviteError(null);
    setNewLink(null);
    createInvite.mutate({ email, role });
  };

  return (
    <div style={shell}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link to="/" style={linkButton}>
          ← Instances
        </Link>
        <h1 style={{ marginTop: 12 }}>Members</h1>

        {isAdmin && (
          <section style={card}>
            <h2 style={h2}>Invite</h2>
            <form
              onSubmit={onInvite}
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
            >
              <Field label="Email">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  style={{ ...inputStyle, minWidth: 240 }}
                />
              </Field>
              <Field label="Role">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
                  style={inputStyle}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </Field>
              <button type="submit" disabled={createInvite.isPending} style={primaryButton}>
                {createInvite.isPending ? 'Inviting…' : 'Invite'}
              </button>
            </form>
            {inviteError && <div style={{ color: '#f99', marginTop: 8 }}>{inviteError}</div>}
            {newLink && (
              <div style={{ marginTop: 12, padding: 12, background: '#0a0a0a', borderRadius: 4 }}>
                <p style={{ margin: 0, fontSize: 13, color: '#aaa' }}>
                  One-time invite link (valid 24h). Send this to the invitee:
                </p>
                <code
                  style={{
                    display: 'block',
                    marginTop: 8,
                    wordBreak: 'break-all',
                    color: '#3ECF8E',
                  }}
                >
                  {newLink}
                </code>
                <button
                  onClick={() => void navigator.clipboard.writeText(newLink)}
                  style={{ ...secondaryButton, marginTop: 8 }}
                >
                  Copy link
                </button>
              </div>
            )}
          </section>
        )}

        {isAdmin && invites.length > 0 && (
          <section style={card}>
            <h2 style={h2}>Open invites</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#888' }}>
                  <th style={th}>Email</th>
                  <th style={th}>Role</th>
                  <th style={th}>Expires</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id} style={{ borderTop: '1px solid #2a2a2a' }}>
                    <td style={td}>{i.email}</td>
                    <td style={td}>{i.role}</td>
                    <td style={td}>{new Date(i.expiresAt).toLocaleString()}</td>
                    <td style={td}>
                      <button onClick={() => revokeInvite.mutate(i.id)} style={linkButton}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section style={card}>
          <h2 style={h2}>Members ({members.length})</h2>
          {isLoading ? (
            <p>Loading…</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#888' }}>
                  <th style={th}>Email</th>
                  <th style={th}>Role</th>
                  <th style={th}>Joined</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.userId} style={{ borderTop: '1px solid #2a2a2a' }}>
                    <td style={td}>
                      {m.email}
                      {m.userId === user?.userId && (
                        <span style={{ color: '#888', fontSize: 12 }}> (you)</span>
                      )}
                    </td>
                    <td style={td}>{m.role}</td>
                    <td style={td}>{new Date(m.createdAt).toLocaleDateString()}</td>
                    <td style={td}>
                      {isAdmin && m.userId !== user?.userId && (
                        <button
                          onClick={() => {
                            if (
                              confirm(`Remove ${m.email}? Tokens and sessions will be invalidated.`)
                            ) {
                              removeMember.mutate(m.userId);
                            }
                          }}
                          style={{ ...linkButton, color: '#f99' }}
                        >
                          Remove
                        </button>
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
