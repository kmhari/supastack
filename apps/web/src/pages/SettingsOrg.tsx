import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { orgApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Shell } from '@/components/Shell';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

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

  if (!isAdmin && user) return <Navigate to="/" replace />;

  return (
    <Shell>
      <PageHeader title="Settings" subtitle="Organization identity and backup destination." />

      {isLoading && <p className="text-muted-foreground">Loading…</p>}

      {org && (
        <>
          <Card className="mb-5">
            <CardHeader>
              <CardTitle>Identity</CardTitle>
              <CardDescription>
                Visible name and apex domain used by every instance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSubmitOrg} className="grid max-w-[480px] gap-3.5">
                <Field label="Organization name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field
                  label="Apex domain"
                  hint="e.g. selfbase.example.com — leave blank to clear"
                >
                  <Input
                    value={apex}
                    onChange={(e) => setApex(e.target.value)}
                    placeholder="selfbase.example.com"
                  />
                </Field>
                <div>
                  <Button type="submit" disabled={saveOrg.isPending}>
                    {saveOrg.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card className="mb-5">
            <CardHeader>
              <CardTitle>Backup store</CardTitle>
              <CardDescription>
                Where on-demand and daily backups are written.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={storeKind}
                onValueChange={(v) => setStoreKind(v as 'local' | 's3')}
                className="mb-4 flex gap-6"
              >
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="local" id="store-local" />
                  <span>Local disk</span>
                </label>
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
                  <RadioGroupItem value="s3" id="store-s3" />
                  <span>S3-compatible</span>
                </label>
              </RadioGroup>

              {storeKind === 'local' && (
                <p className="m-0 text-sm text-muted-foreground">
                  Backups stored at <code>/var/selfbase/backups/&lt;ref&gt;/</code> on the host.
                </p>
              )}
              {storeKind === 's3' && (
                <div className="grid max-w-[480px] gap-3">
                  <Field label="Endpoint" hint="Omit for AWS S3; set for MinIO / R2 / B2">
                    <Input
                      value={s3.endpoint}
                      onChange={(e) => setS3({ ...s3, endpoint: e.target.value })}
                      placeholder="https://s3.amazonaws.com"
                    />
                  </Field>
                  <Field label="Bucket">
                    <Input
                      value={s3.bucket}
                      onChange={(e) => setS3({ ...s3, bucket: e.target.value })}
                    />
                  </Field>
                  <Field label="Region">
                    <Input
                      value={s3.region}
                      onChange={(e) => setS3({ ...s3, region: e.target.value })}
                    />
                  </Field>
                  <Field label="Access key ID">
                    <Input
                      value={s3.accessKeyId}
                      onChange={(e) => setS3({ ...s3, accessKeyId: e.target.value })}
                    />
                  </Field>
                  <Field label="Secret access key">
                    <Input
                      type="password"
                      value={s3.secretAccessKey}
                      onChange={(e) => setS3({ ...s3, secretAccessKey: e.target.value })}
                    />
                  </Field>
                </div>
              )}
              <div className="mt-4">
                <Button onClick={() => saveStore.mutate()} disabled={saveStore.isPending}>
                  {saveStore.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </Shell>
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
      <Label className="mb-1.5 block text-sm text-foreground-light">{label}</Label>
      {children}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
