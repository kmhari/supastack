import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { instancesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { ProjectShell } from '@/components/ProjectShell';
import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface InstanceCert {
  reachable: boolean;
  issued: boolean;
  issuer?: string;
  notAfter?: string;
  selfSigned?: boolean;
  error?: string;
}

interface InstanceDetail {
  ref: string;
  name: string;
  status: string;
  supabaseVersion: string;
  urls: { kong: string | null; studio: string | null };
  provisionError?: string | null;
  createdAt: string;
  cert: InstanceCert | null;
}

export function ProjectGeneralPage(): React.ReactElement {
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

  const [name, setName] = useState('');
  useEffect(() => {
    if (data) setName(data.name);
  }, [data]);

  const saveName = useMutation({
    mutationFn: () => instancesApi.patch(ref, { name: name.trim() }),
    onSuccess: () => {
      toast.success('Project name saved');
      qc.invalidateQueries({ queryKey: ['instances'] });
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      toast.error(e.response?.data?.error?.message ?? 'failed to save');
    },
  });

  const lifecycle = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'restart' | 'delete') => {
      if (action === 'delete') return instancesApi.delete(ref);
      return (instancesApi[action] as (r: string) => Promise<unknown>)(ref);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const onSubmitName = (e: FormEvent): void => {
    e.preventDefault();
    if (!name.trim() || name.trim() === data?.name) return;
    saveName.mutate();
  };

  if (isLoading) {
    return (
      <ProjectShell title="General">
        <p className="text-muted-foreground">Loading…</p>
      </ProjectShell>
    );
  }
  if (error || !data) {
    return (
      <ProjectShell title="General">
        <p className="text-destructive">Failed to load project.</p>
      </ProjectShell>
    );
  }

  return (
    <ProjectShell
      title="Project Settings"
      subtitle="General configuration, project access, and lifecycle."
    >
      {data.provisionError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>Provision failed: {data.provisionError}</AlertDescription>
        </Alert>
      )}

      <Section title="General settings">
        <form onSubmit={onSubmitName}>
          <Card>
            <CardRow label="Project name" hint="Displayed throughout the dashboard.">
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </CardRow>
            <CardRow label="Project ID" hint="Reference used in APIs and URLs.">
              <div className="flex gap-2">
                <Input value={data.ref} readOnly className="flex-1 font-mono text-sm" />
                <CopyButton value={data.ref} variant="outline" />
              </div>
            </CardRow>
            <CardRow label="Project region" hint="Where this project's database lives.">
              <Input value="Self-hosted" readOnly />
            </CardRow>
            <CardFooter>
              <Button
                type="submit"
                disabled={saveName.isPending || !name.trim() || name.trim() === data.name}
              >
                {saveName.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </Section>

      <Section title="URLs" description="The HTTPS endpoint where this project is reachable.">
        <Card>
          <CardContent>
            {!data.urls.kong ? (
              <p className="m-0 text-sm text-muted-foreground">
                Set an apex domain on the org to expose URLs.
              </p>
            ) : data.status !== 'running' ? (
              <p className="m-0 text-sm text-muted-foreground">
                URLs become available once the project is running.
              </p>
            ) : !data.cert?.issued ? (
              <div className="flex items-start gap-3 text-sm">
                <Loader2 className="mt-0.5 size-4 flex-none animate-spin text-warn" />
                <div>
                  <div className="text-foreground">Waiting for HTTPS certificate…</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Caddy is requesting a Let&apos;s Encrypt cert via HTTP-01. Usually completes
                    in 5–15s once DNS for the apex resolves.
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
          {data.urls.kong && data.status === 'running' && data.cert?.issued && (
            <>
              <CardRow label="API" hint="Public URL for /rest/v1, /auth/v1, /realtime/v1, …">
                <div className="flex gap-2">
                  <Input
                    value={data.urls.kong}
                    readOnly
                    className="flex-1 font-mono text-sm"
                  />
                  <CopyButton value={data.urls.kong} variant="outline" />
                </div>
              </CardRow>
              <CardRow label="Studio" hint={`Cert issued by ${data.cert.issuer ?? 'a CA'} · valid until ${data.cert.notAfter ?? '—'}`}>
                <a
                  href={`${data.urls.kong}/project/default`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-success no-underline hover:underline"
                >
                  Open Studio <ExternalLink className="size-3" />
                </a>
              </CardRow>
            </>
          )}
        </Card>
      </Section>

      <Section
        title="Project access"
        description="All org members have access to this project. Manage who's in the org from Settings → Members."
      >
        <Card>
          <CardContent>
            <Button variant="outline" onClick={() => navigate('/settings/members')}>
              Manage members
            </Button>
          </CardContent>
        </Card>
      </Section>

      {isAdmin && (
        <Section
          title="Project availability"
          description="Pause, resume, or restart the project containers."
        >
          <Card>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => lifecycle.mutate('pause')}
                  disabled={data.status !== 'running'}
                >
                  Pause
                </Button>
                <Button
                  variant="outline"
                  onClick={() => lifecycle.mutate('resume')}
                  disabled={data.status !== 'paused'}
                >
                  Resume
                </Button>
                <Button
                  variant="outline"
                  onClick={() => lifecycle.mutate('restart')}
                  disabled={!['running', 'stopped'].includes(data.status)}
                >
                  Restart
                </Button>
              </div>
            </CardContent>
          </Card>
        </Section>
      )}

      {isAdmin && (
        <Section
          title="Delete project"
          titleClassName="text-destructive"
          description="Permanently deletes the project, its database, backups, and audit history. This cannot be undone."
        >
          <Card>
            <CardContent>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                Delete project
              </Button>
            </CardContent>
          </Card>
        </Section>
      )}

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(next) => {
          setDeleteOpen(next);
          if (!next) setDeleteConfirm('');
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{data.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently destroys all data in the project. Type the project name to confirm.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={data.name}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteConfirm !== data.name}
              onClick={() => {
                lifecycle.mutate('delete');
                setDeleteOpen(false);
                navigate('/');
              }}
            >
              Delete forever
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProjectShell>
  );
}

/**
 * Section wrapper: h2 + optional description rendered ABOVE the Card —
 * matches Supabase's settings layout where each grouping has its title
 * outside the card frame.
 */
function Section({
  title,
  description,
  titleClassName,
  children,
}: {
  title: string;
  description?: string;
  titleClassName?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div>
      <h2 className={cn('m-0 mb-3 text-lg font-medium text-foreground', titleClassName)}>
        {title}
      </h2>
      {description && (
        <p className="m-0 mb-4 text-sm text-muted-foreground">{description}</p>
      )}
      {children}
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
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[200px_1fr] items-start gap-6">
      <div className="pt-2">
        <Label className="text-sm text-foreground">{label}</Label>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * Sectioned form row inside a Card. Renders as its own card section
 * so the parent `<Card>`'s `divide-y` draws a hairline between rows.
 * Matches Supabase's `py-4 px-6` rhythm per section, with label + hint
 * stacked left and field right.
 */
function CardRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[1fr_minmax(0,1fr)] items-start gap-6 px-6 py-4">
      <div className="pt-1">
        <Label className="text-sm font-normal text-foreground">{label}</Label>
        {hint && (
          <div className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
