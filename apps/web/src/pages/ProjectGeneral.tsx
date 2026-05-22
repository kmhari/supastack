import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { instancesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ProjectShell } from '@/components/ProjectShell';
import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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

      {/* General settings — name, project ID, region (each row = its own card section
          per Supabase's pattern; divide-y on the Card primitive draws hairlines between) */}
      <form onSubmit={onSubmitName}>
        <Card>
          <CardHeader>
            <CardTitle>General settings</CardTitle>
          </CardHeader>
          <CardRow label="Project name" hint="Displayed throughout the dashboard.">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </CardRow>
          <CardRow label="Project ID" hint="Reference used in APIs and URLs.">
            <div className="flex gap-2">
              <Input value={data.ref} readOnly className="font-mono text-sm" />
              <CopyButton value={data.ref} variant="outline" />
            </div>
          </CardRow>
          <CardRow label="Project region" hint="Where this project's database lives.">
            <Input value="Self-hosted" readOnly className="text-muted-foreground" />
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

      {/* URLs */}
      <Card>
        <CardHeader>
          <CardTitle>URLs</CardTitle>
          <CardDescription>The HTTPS endpoint where this project is reachable.</CardDescription>
        </CardHeader>
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
                  Caddy is requesting a Let&apos;s Encrypt cert via HTTP-01. Usually completes in
                  5–15s once DNS for the apex resolves.
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 text-sm">
              <Field label="API">
                <div className="flex gap-2">
                  <Input
                    value={data.urls.kong}
                    readOnly
                    className="font-mono text-xs text-foreground"
                  />
                  <CopyButton value={data.urls.kong} variant="outline" />
                </div>
              </Field>
              <Field label="Studio">
                <a
                  href={`${data.urls.kong}/project/default`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-success no-underline hover:underline"
                >
                  Open Studio <ExternalLink className="size-3" />
                </a>
              </Field>
              {data.cert.notAfter && (
                <div className="text-xs text-muted-foreground">
                  Cert issued by {data.cert.issuer ?? 'a CA'} · valid until {data.cert.notAfter}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Project access */}
      <Card>
        <CardHeader>
          <CardTitle>Project access</CardTitle>
          <CardDescription>
            All org members have access to this project. Manage who&apos;s in the org from
            Settings → Members.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => navigate('/settings/members')}>
            Manage members
          </Button>
        </CardContent>
      </Card>

      {/* Project availability — lifecycle */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>Project availability</CardTitle>
            <CardDescription>Pause, resume, or restart the project containers.</CardDescription>
          </CardHeader>
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
      )}

      {/* Delete project */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-destructive">Delete project</CardTitle>
            <CardDescription>
              Permanently deletes the project, its database, backups, and audit history. This
              cannot be undone.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              Delete project
            </Button>
          </CardContent>
        </Card>
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
 * Matches Supabase's `py-4 px-6` rhythm per section.
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
    <div className="grid grid-cols-[280px_1fr] items-start gap-8 px-6 py-5">
      <div className="pt-2">
        <Label className="text-sm font-normal text-foreground">{label}</Label>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
