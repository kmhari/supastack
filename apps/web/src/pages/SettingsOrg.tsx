import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { orgApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Shell } from '@/components/Shell';
import { SettingsLayout } from '@/components/SettingsLayout';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { CardRow } from '@/components/CardRow';
import { InputWithCopy } from '@/components/InputWithCopy';
import { cn } from '@/lib/utils';

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

  if (!isAdmin && user) return <Navigate to="/dashboard" replace />;

  return (
    <Shell bare>
      <SettingsLayout>
        <PageHeader title="Overview" subtitle="Organization identity and backup destination." />

        {isLoading && <p className="text-muted-foreground">Loading…</p>}

        {org && (
          <>
            <Section
              title="Identity"
              description="Visible name and apex domain used by every instance."
            >
              <form onSubmit={onSubmitOrg}>
                <Card className="divide-y divide-border-soft">
                  <CardRow label="Organization name">
                    <InputWithCopy noCopy value={name} onChange={(e) => setName(e.target.value)} />
                  </CardRow>
                  <CardRow
                    label="Apex domain"
                    hint="e.g. selfbase.example.com — leave blank to clear"
                  >
                    <InputWithCopy
                      noCopy
                      value={apex}
                      onChange={(e) => setApex(e.target.value)}
                      placeholder="selfbase.example.com"
                    />
                  </CardRow>
                </Card>
                <div className="mt-3">
                  <Button type="submit" disabled={saveOrg.isPending}>
                    {saveOrg.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </form>
            </Section>

            <Section
              title="Backup store"
              description="Where on-demand and daily backups are written."
            >
              <Card className="divide-y divide-border-soft">
                <CardRow label="Destination" hint="Where backup blobs are written.">
                  <RadioGroup
                    value={storeKind}
                    onValueChange={(v) => setStoreKind(v as 'local' | 's3')}
                    className="flex gap-6"
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
                </CardRow>

                {storeKind === 'local' && (
                  <CardRow label="Path">
                    <div className="text-sm text-muted-foreground">
                      Backups stored at <code>/var/selfbase/backups/&lt;ref&gt;/</code> on the host.
                    </div>
                  </CardRow>
                )}
                {storeKind === 's3' && (
                  <>
                    <CardRow label="Endpoint" hint="Omit for AWS S3; set for MinIO / R2 / B2">
                      <InputWithCopy
                        noCopy
                        value={s3.endpoint}
                        onChange={(e) => setS3({ ...s3, endpoint: e.target.value })}
                        placeholder="https://s3.amazonaws.com"
                      />
                    </CardRow>
                    <CardRow label="Bucket">
                      <InputWithCopy
                        noCopy
                        value={s3.bucket}
                        onChange={(e) => setS3({ ...s3, bucket: e.target.value })}
                      />
                    </CardRow>
                    <CardRow label="Region">
                      <InputWithCopy
                        noCopy
                        value={s3.region}
                        onChange={(e) => setS3({ ...s3, region: e.target.value })}
                      />
                    </CardRow>
                    <CardRow label="Access key ID">
                      <InputWithCopy
                        noCopy
                        value={s3.accessKeyId}
                        onChange={(e) => setS3({ ...s3, accessKeyId: e.target.value })}
                      />
                    </CardRow>
                    <CardRow label="Secret access key">
                      <InputWithCopy
                        noCopy
                        type="password"
                        value={s3.secretAccessKey}
                        onChange={(e) => setS3({ ...s3, secretAccessKey: e.target.value })}
                      />
                    </CardRow>
                  </>
                )}
              </Card>
              <div className="mt-3">
                <Button onClick={() => saveStore.mutate()} disabled={saveStore.isPending}>
                  {saveStore.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </Section>
          </>
        )}
      </SettingsLayout>
    </Shell>
  );
}

function Section({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div className={cn('mb-6', className)}>
      <h2 className="m-0 mb-3 text-lg font-medium text-foreground">{title}</h2>
      {description && <p className="m-0 mb-4 text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}
