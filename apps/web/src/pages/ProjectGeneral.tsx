import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { instancesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { ProjectShell } from '@/components/ProjectShell';
import { CardRow } from '@/components/CardRow';
import { InputWithCopy } from '@/components/InputWithCopy';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
              <InputWithCopy
                noCopy
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </CardRow>
            <CardRow label="Project ID" hint="Reference used in APIs and URLs.">
              <InputWithCopy mono readOnly value={data.ref} />
            </CardRow>
            <CardRow label="Project region" hint="Where this project's database lives.">
              <InputWithCopy noCopy readOnly value="Self-hosted" />
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
                    Caddy is requesting a Let&apos;s Encrypt cert via HTTP-01. Usually completes in
                    5–15s once DNS for the apex resolves.
                  </div>
                </div>
              </div>
            ) : null}
          </CardContent>
          {data.urls.kong && data.status === 'running' && data.cert?.issued && (
            <>
              <CardRow label="API" hint="Public URL for /rest/v1, /auth/v1, /realtime/v1, …">
                <InputWithCopy mono readOnly value={data.urls.kong} />
              </CardRow>
              <CardRow
                label="Studio"
                hint={`Cert issued by ${data.cert.issuer ?? 'a CA'} · valid until ${data.cert.notAfter ?? '—'}`}
              >
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
          description="Restart or pause your project when performing maintenance"
        >
          <Card>
            <AvailabilityRow
              title="Restart project"
              hint="Your project will not be available for a few minutes."
            >
              <SplitButton
                disabled={!['running', 'stopped'].includes(data.status)}
                primaryLabel="Restart project"
                primaryIcon={<RefreshCw className="size-3.5" />}
                onPrimary={() => lifecycle.mutate('restart')}
                items={[
                  {
                    label: 'Full restart',
                    description:
                      'Restarts every container in the project. Slower but recovers from any state.',
                    onSelect: () => lifecycle.mutate('restart'),
                  },
                ]}
              />
            </AvailabilityRow>
            {data.status === 'paused' ? (
              <AvailabilityRow
                title="Resume project"
                hint="Bring the project back up. Containers will start in a few seconds."
              >
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => lifecycle.mutate('resume')}
                >
                  <Play className="size-3.5" />
                  Resume project
                </Button>
              </AvailabilityRow>
            ) : (
              <AvailabilityRow
                title="Pause project"
                hint="Your project will not be accessible while it is paused."
              >
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={data.status !== 'running'}
                  onClick={() => lifecycle.mutate('pause')}
                >
                  <Pause className="size-3.5" />
                  Pause project
                </Button>
              </AvailabilityRow>
            )}
          </Card>
        </Section>
      )}

      {isAdmin && (
        <Section
          title="Delete project"
          description="Permanently remove your project and its database"
        >
          <Card>
            <CardContent>
              <div className="flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive-bg/30 p-3">
                <span className="flex size-7 flex-none items-center justify-center rounded-md bg-destructive/20 text-destructive">
                  <AlertTriangle className="size-4" />
                </span>
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-medium text-foreground">
                    Deleting this project will also remove your database.
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Make sure you have made a backup if you want to keep your data.
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="mt-2.5 self-start"
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete project
                  </Button>
                </div>
              </div>
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
                navigate('/dashboard');
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
 * Sub-section inside the Project availability card. Each one has a
 * bold title, a hint underneath, and a full-width action button row.
 * The Card's divide-y draws a hairline between siblings.
 */
function AvailabilityRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="px-6 py-5">
      <div className="text-sm font-medium text-foreground">{title}</div>
      <div className="mb-3 mt-0.5 text-sm text-muted-foreground">{hint}</div>
      {children}
    </div>
  );
}

/**
 * Split button — primary action on the left fills the available width,
 * chevron-down on the right opens a DropdownMenu with alternative
 * actions. Matches Supabase's "Restart project" control.
 */
function SplitButton({
  disabled,
  primaryLabel,
  primaryIcon,
  onPrimary,
  items,
}: {
  disabled?: boolean;
  primaryLabel: string;
  primaryIcon?: React.ReactNode;
  onPrimary: () => void;
  items: { label: string; description?: string; onSelect: () => void }[];
}): React.ReactElement {
  return (
    <div className="flex w-full">
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={onPrimary}
        className="flex-1 rounded-r-none border-r-0"
      >
        {primaryIcon}
        {primaryLabel}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label="More restart options"
            className="rounded-l-none border-l border-border-soft px-2"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 p-1">
          {items.map((it) => (
            <DropdownMenuItem
              key={it.label}
              onSelect={(e) => {
                e.preventDefault();
                it.onSelect();
              }}
              className="flex-col items-start gap-1 px-3 py-2.5"
            >
              <span className="text-sm font-medium text-foreground">{it.label}</span>
              {it.description && (
                <span className="text-xs leading-snug text-muted-foreground">{it.description}</span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
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
      {description && <p className="m-0 mb-4 text-sm text-muted-foreground">{description}</p>}
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
