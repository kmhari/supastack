import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { orgApi } from '../lib/api.js';
import { useAuth } from '../lib/auth-context.js';

interface OrgRow {
  id: string;
  name: string;
  apexDomain: string | null;
  backupStoreKind: 'local' | 's3';
}

export function SettingsOrgPage(): React.ReactElement {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const { data: org, isLoading } = useQuery<OrgRow>({
    queryKey: ['org'],
    queryFn: () => orgApi.get() as Promise<OrgRow>,
  });

  // Org name + apex
  const [name, setName] = useState('');
  const [apex, setApex] = useState('');
  useEffect(() => {
    if (org) {
      setName(org.name);
      setApex(org.apexDomain ?? '');
    }
  }, [org]);

  const saveOrg = useMutation({
    mutationFn: (payload: { name?: string; apexDomain?: string }) => orgApi.patch(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org'] }),
  });

  // Backup-store config
  const [storeKind, setStoreKind] = useState<'local' | 's3'>('local');
  const [s3, setS3] = useState({
    endpoint: '',
    bucket: '',
    region: 'us-east-1',
    accessKeyId: '',
    secretAccessKey: '',
  });
  useEffect(() => {
    if (org) setStoreKind(org.backupStoreKind);
  }, [org]);

  const saveStore = useMutation({
    mutationFn: () =>
      orgApi.setBackupStore(
        storeKind === 'local'
          ? { kind: 'local' }
          : {
              kind: 's3',
              endpoint: s3.endpoint || undefined,
              bucket: s3.bucket,
              region: s3.region,
              accessKeyId: s3.accessKeyId,
              secretAccessKey: s3.secretAccessKey,
            },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org'] }),
  });

  const onSubmitOrg = (e: FormEvent): void => {
    e.preventDefault();
    saveOrg.mutate({ name, apexDomain: apex.trim() || undefined });
  };

  if (isLoading || !org) {
    return <div style={shell}>Loading…</div>;
  }
  if (!isAdmin) {
    return (
      <div style={shell}>
        <p>You need admin access to view org settings.</p>
        <Link to="/" style={linkButton}>
          ← Back
        </Link>
      </div>
    );
  }

  return (
    <div style={shell}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <Link to="/" style={linkButton}>
          ← Instances
        </Link>
        <h1 style={{ marginTop: 12 }}>Org settings</h1>

        <section style={card}>
          <h2 style={h2}>Identity</h2>
          <form onSubmit={onSubmitOrg} style={{ display: 'grid', gap: 12 }}>
            <Field label="Org name">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Apex domain (e.g. selfbase.example.com)">
              <input
                value={apex}
                onChange={(e) => setApex(e.target.value)}
                style={inputStyle}
                placeholder="leave blank to clear"
              />
            </Field>
            <div>
              <button type="submit" disabled={saveOrg.isPending} style={primaryButton}>
                {saveOrg.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </section>

        <section style={card}>
          <h2 style={h2}>Backup store</h2>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            <label>
              <input
                type="radio"
                checked={storeKind === 'local'}
                onChange={() => setStoreKind('local')}
              />{' '}
              Local disk
            </label>
            <label>
              <input
                type="radio"
                checked={storeKind === 's3'}
                onChange={() => setStoreKind('s3')}
              />{' '}
              S3-compatible
            </label>
          </div>
          {storeKind === 'local' && (
            <p style={{ color: '#888', fontSize: 13 }}>
              Backups stored at <code>/var/selfbase/backups/&lt;ref&gt;/</code> on the host.
            </p>
          )}
          {storeKind === 's3' && (
            <div style={{ display: 'grid', gap: 8 }}>
              <Field label="Endpoint (omit for AWS S3, set for MinIO/R2/B2)">
                <input
                  value={s3.endpoint}
                  onChange={(e) => setS3({ ...s3, endpoint: e.target.value })}
                  style={inputStyle}
                  placeholder="https://s3.amazonaws.com"
                />
              </Field>
              <Field label="Bucket">
                <input
                  value={s3.bucket}
                  onChange={(e) => setS3({ ...s3, bucket: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Region">
                <input
                  value={s3.region}
                  onChange={(e) => setS3({ ...s3, region: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Access key ID">
                <input
                  value={s3.accessKeyId}
                  onChange={(e) => setS3({ ...s3, accessKeyId: e.target.value })}
                  style={inputStyle}
                />
              </Field>
              <Field label="Secret access key">
                <input
                  type="password"
                  value={s3.secretAccessKey}
                  onChange={(e) => setS3({ ...s3, secretAccessKey: e.target.value })}
                  style={inputStyle}
                />
              </Field>
            </div>
          )}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => saveStore.mutate()}
              disabled={saveStore.isPending}
              style={primaryButton}
            >
              {saveStore.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
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
const linkButton: React.CSSProperties = { color: '#7ab8f5', textDecoration: 'none', fontSize: 13 };

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
