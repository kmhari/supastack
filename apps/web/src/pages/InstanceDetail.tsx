import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ArrowRight, ExternalLink, Eye, EyeOff, Loader2 } from 'lucide-react';
import { instancesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Shell } from '@/components/Shell';
import { PageHeader } from '@/components/PageHeader';
import { StatusPill } from '@/components/StatusPill';
import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  subject?: string;
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
  ports?: Record<string, number>;
  provisionError?: string | null;
  createdAt: string;
  cert: InstanceCert | null;
}
interface Credentials {
  ref: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
  postgresPassword: string;
  dashboardPassword: string;
  connectionStrings: Record<string, string>;
}

export function InstanceDetailPage(): React.ReactElement {
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

  const lifecycle = useMutation({
    mutationFn: async (action: 'pause' | 'resume' | 'restart' | 'delete') => {
      if (action === 'delete') return instancesApi.delete(ref);
      return (instancesApi[action] as (r: string) => Promise<unknown>)(ref);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });

  const [revealOpen, setRevealOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [revealPassword, setRevealPassword] = useState('');
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);

  const doReveal = async (): Promise<void> => {
    setRevealError(null);
    try {
      const out = (await instancesApi.reveal(ref, { password: revealPassword })) as Credentials;
      setCreds(out);
      setRevealOpen(false);
      setRevealPassword('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setRevealError(e.response?.data?.error?.message ?? 'reveal failed');
    }
  };

  if (isLoading) {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    );
  }
  if (error || !data) {
    return (
      <Shell>
        <p className="text-destructive">Failed to load instance.</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-3 flex justify-between text-sm">
        <Link to="/" className="text-muted-foreground no-underline hover:text-foreground">
          <ArrowLeft className="inline size-3.5" /> All projects
        </Link>
        <Link
          to={`/p/${ref}/backups`}
          className="text-muted-foreground no-underline hover:text-foreground"
        >
          Backups <ArrowRight className="inline size-3.5" />
        </Link>
      </div>

      <PageHeader title={data.name} subtitle={data.ref} right={<StatusPill status={data.status} />} />

      {data.provisionError && (
        <Alert variant="destructive" className="mb-5">
          <AlertCircle />
          <AlertDescription>Provision failed: {data.provisionError}</AlertDescription>
        </Alert>
      )}

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>URLs</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.urls.kong ? (
            <p className="m-0 text-sm text-muted-foreground">
              Set an apex domain on the org to expose URLs.
            </p>
          ) : data.status !== 'running' ? (
            <p className="m-0 text-sm text-muted-foreground">
              URLs become available once the instance is running.
            </p>
          ) : !data.cert?.issued ? (
            <div className="flex items-start gap-3 text-sm">
              <Loader2 className="mt-0.5 size-4 flex-none animate-spin text-warn" />
              <div>
                <div className="text-foreground">Waiting for HTTPS certificate…</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {data.cert?.selfSigned
                    ? `Caddy served a self-signed fallback — check that *.${apexFromUrl(data.urls.kong)} resolves to this server's IP and isn't blocked by your DNS provider.`
                    : data.cert?.error
                      ? `Probe error: ${data.cert.error}`
                      : `Caddy is requesting a Let's Encrypt cert via HTTP-01. Usually completes in 5–15s once DNS for ${apexFromUrl(data.urls.kong)} resolves.`}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 text-sm">
              <DetailRow label="API">
                <code className="font-mono text-sm">{data.urls.kong}</code>
              </DetailRow>
              <DetailRow label="Studio">
                <a
                  href={`${data.urls.kong}/project/default`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-success no-underline hover:underline"
                >
                  Open Studio <ExternalLink className="inline size-3" />
                </a>
              </DetailRow>
              {data.cert.notAfter && (
                <DetailRow label="Cert">
                  <span className="text-xs text-muted-foreground">
                    {data.cert.issuer ?? 'CA'} · valid until {data.cert.notAfter}
                  </span>
                </DetailRow>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-5">
        <CardHeader>
          <CardTitle>Credentials</CardTitle>
          <CardDescription>
            Secrets are hidden by default. Revealing requires re-entering your password and is
            recorded in the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!creds ? (
            <Button onClick={() => setRevealOpen(true)}>Reveal credentials</Button>
          ) : (
            <div className="grid gap-2">
              <Reveal label="anon_key" value={creds.anonKey} />
              <Reveal label="service_role_key" value={creds.serviceRoleKey} secret />
              <Reveal label="jwt_secret" value={creds.jwtSecret} secret />
              <Reveal label="postgres_password" value={creds.postgresPassword} secret />
              <Reveal label="dashboard_password" value={creds.dashboardPassword} secret />
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
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
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Reveal credentials dialog */}
      <Dialog open={revealOpen} onOpenChange={setRevealOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Re-authenticate</DialogTitle>
            <DialogDescription>
              Enter your password to reveal instance credentials. This action is recorded in the
              audit log.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="reveal-pw" className="mb-1.5 block text-sm text-foreground-light">
              Your password
            </Label>
            <Input
              id="reveal-pw"
              type="password"
              placeholder="your password"
              value={revealPassword}
              onChange={(e) => setRevealPassword(e.target.value)}
              autoFocus
            />
            {revealError && (
              <Alert variant="destructive" className="mt-3">
                <AlertCircle />
                <AlertDescription>{revealError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevealOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void doReveal()}>Reveal</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete instance dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete &ldquo;{data.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This permanently destroys all data in the instance. Cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
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
    </Shell>
  );
}

function apexFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    const dot = host.indexOf('.');
    return dot >= 0 ? host.slice(dot + 1) : host;
  } catch {
    return 'your apex';
  }
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function Reveal({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}): React.ReactElement {
  const [shown, setShown] = useState(!secret);
  return (
    <div className="grid grid-cols-[200px_1fr_auto_auto] items-center gap-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <code className="overflow-hidden text-ellipsis whitespace-nowrap rounded-sm border border-border-soft bg-background px-2.5 py-1.5 font-mono text-sm text-foreground">
        {shown ? value : '••••••••••••'}
      </code>
      {secret ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setShown((v) => !v)}
          aria-label={shown ? 'Hide' : 'Show'}
        >
          {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </Button>
      ) : (
        <span />
      )}
      <CopyButton value={value} variant="ghost" iconOnly />
    </div>
  );
}
