/**
 * Settings → Database — pooler health panel (feature 008 US2).
 *
 * Shows:
 *  - Supavisor reachability + pooler endpoint URL
 *  - Per-project table with tenant status + actions (Re-register, Reset PG password)
 *  - Recent reconciler runs (last 30)
 *  - Recent pooler events tail (last 50)
 *  - "Run reconciler now" button at top
 *
 * Auto-refreshes every 10s while document is visible. Immediate refetch
 * after any user action.
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw, AlertCircle, CheckCircle2, XCircle, KeyRound, Copy } from 'lucide-react';
import {
  poolerApi,
  type PoolerStatusResponse,
  type PoolerStatusProject,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Shell } from '@/components/Shell';
import { SettingsLayout } from '@/components/SettingsLayout';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

const POLL_MS = 10_000;

export function SettingsDatabasePage(): React.ReactElement {
  const { user } = useAuth();
  if (user && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<PoolerStatusResponse>({
    queryKey: ['pooler-status'],
    queryFn: () => poolerApi.status(),
    refetchInterval: () =>
      typeof document !== 'undefined' && document.visibilityState === 'visible' ? POLL_MS : false,
  });

  const runReconciler = useMutation({
    mutationFn: () => poolerApi.runReconciler(),
    onSuccess: () => {
      toast.success('Reconciler triggered');
      void qc.invalidateQueries({ queryKey: ['pooler-status'] });
    },
    onError: (err: Error) => {
      toast.error(`Trigger failed: ${err.message}`);
    },
  });

  if (isLoading) {
    return (
      <Shell bare>
        <SettingsLayout>
          <PageHeader title="Database" subtitle="Connection pooler health" />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </SettingsLayout>
      </Shell>
    );
  }

  if (error || !data) {
    return (
      <Shell bare>
        <SettingsLayout>
          <PageHeader title="Database" subtitle="Connection pooler health" />
          <p className="text-sm text-destructive">Failed to load: {error?.message ?? 'unknown'}</p>
        </SettingsLayout>
      </Shell>
    );
  }

  return (
    <Shell bare>
      <SettingsLayout>
        <PageHeader
          title="Database"
          subtitle="Connection pooler health and per-project tenant status."
          right={
            <Button
              variant="outline"
              size="sm"
              onClick={() => runReconciler.mutate()}
              disabled={runReconciler.isPending}
            >
              <RefreshCw className="size-4" />
              Run reconciler now
            </Button>
          }
        />

        <div className="space-y-6">
          <PoolerOverviewCard data={data} />
          <ProjectsTableCard projects={data.projects} onAction={() => void refetch()} />
          <ReconcilerRunsCard runs={data.recent_runs} />
          <PoolerEventsCard events={data.recent_events} />
        </div>
      </SettingsLayout>
    </Shell>
  );
}

// ─── Overview card: supavisor health + endpoint ────────────────────────────

function PoolerOverviewCard({ data }: { data: PoolerStatusResponse }): React.ReactElement {
  const pillVariant = data.supavisor.reachable ? 'success' : 'danger';
  return (
    <Card>
      <CardHeader>
        <CardTitle>Connection Pooler</CardTitle>
        <CardDescription>
          Top-level Supavisor that fronts all per-project Postgres instances.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Status</span>
            <StatusPill variant={pillVariant}>
              {data.supavisor.reachable ? 'Up' : 'Down'}
            </StatusPill>
          </div>
          <Separator orientation="vertical" className="h-6" />
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Endpoint</span>
            <code className="text-sm bg-muted px-2 py-0.5 rounded">{data.endpoint ?? 'n/a'}</code>
            {data.endpoint ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard.writeText(data.endpoint!);
                  toast.success('Endpoint copied');
                }}
              >
                <Copy className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </div>
        {!data.supavisor.reachable ? (
          <div className="mt-4 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" />
            Pooler offline — projects connecting via the pooler endpoint will fail.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ─── Per-project table ─────────────────────────────────────────────────────

function ProjectsTableCard({
  projects,
  onAction,
}: {
  projects: PoolerStatusProject[];
  onAction: () => void;
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Projects ({projects.length})</CardTitle>
        <CardDescription>
          Tenant registration state per project. Click an action button if
          something needs intervention.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No projects yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground border-b border-border-soft">
                  <th className="text-left py-2 pr-3">Project</th>
                  <th className="text-left py-2 pr-3">Instance</th>
                  <th className="text-left py-2 pr-3">Tenant</th>
                  <th className="text-left py-2 pr-3">In Supavisor</th>
                  <th className="text-left py-2 pr-3">Last reconciled</th>
                  <th className="text-right py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <ProjectRow key={p.ref} project={p} onAction={onAction} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectRow({
  project,
  onAction,
}: {
  project: PoolerStatusProject;
  onAction: () => void;
}): React.ReactElement {
  const [busy, setBusy] = useState<null | 'reregister' | 'reset'>(null);

  const reregister = async (): Promise<void> => {
    setBusy('reregister');
    try {
      const r = await poolerApi.reregister(project.ref);
      if (r.tenant_status === 'active') {
        toast.success(`${project.name}: re-registered as active`);
      } else {
        toast.warning(`${project.name}: status now ${r.tenant_status ?? 'unknown'}`);
      }
      onAction();
    } catch (err) {
      toast.error(`Re-register failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async (): Promise<void> => {
    setBusy('reset');
    try {
      const r = await poolerApi.resetPgPassword(project.ref);
      toast.success(`${project.name}: ${r.message} (status: ${r.pooler_tenant_status ?? 'unknown'})`);
      onAction();
    } catch (err) {
      toast.error(`Reset failed: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const tenantBadgeVariant = tenantStatusVariant(project.tenant_status);
  const showReset = project.tenant_status === 'pg_password_drift';
  const lastReconciled = project.last_reconciled_at
    ? new Date(project.last_reconciled_at).toLocaleString()
    : '—';

  return (
    <tr className="border-b border-border-soft last:border-0">
      <td className="py-2 pr-3">
        <div className="font-medium">{project.name}</div>
        <div className="text-xs text-muted-foreground font-mono">{project.ref}</div>
      </td>
      <td className="py-2 pr-3">
        <Badge variant={project.instance_status === 'running' ? 'default' : 'secondary'}>
          {project.instance_status}
        </Badge>
      </td>
      <td className="py-2 pr-3">
        <StatusPill variant={tenantBadgeVariant}>
          {project.tenant_status ?? 'not registered'}
        </StatusPill>
        {project.last_error ? (
          <div className="text-xs text-muted-foreground mt-1 max-w-md truncate" title={project.last_error}>
            {project.last_error}
          </div>
        ) : null}
      </td>
      <td className="py-2 pr-3">
        {project.supavisor_present === null ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : project.supavisor_present ? (
          <CheckCircle2 className="size-4 text-success" />
        ) : (
          <XCircle className="size-4 text-destructive" />
        )}
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground">{lastReconciled}</td>
      <td className="py-2 text-right space-x-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void reregister()}
          disabled={busy !== null || project.instance_status !== 'running'}
        >
          {busy === 'reregister' ? '…' : 'Re-register'}
        </Button>
        {showReset ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void resetPassword()}
            disabled={busy !== null}
          >
            <KeyRound className="size-3.5" />
            {busy === 'reset' ? '…' : 'Reset PG password'}
          </Button>
        ) : null}
      </td>
    </tr>
  );
}

// ─── Reconciler runs ───────────────────────────────────────────────────────

function ReconcilerRunsCard({
  runs,
}: {
  runs: PoolerStatusResponse['recent_runs'];
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent reconciler runs</CardTitle>
        <CardDescription>Daily at 03:00 UTC, plus manual triggers. Last 30 shown.</CardDescription>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase text-muted-foreground border-b border-border-soft">
                  <th className="text-left py-2 pr-3">Started</th>
                  <th className="text-left py-2 pr-3">Status</th>
                  <th className="text-left py-2 pr-3">Instances</th>
                  <th className="text-left py-2 pr-3">Actions</th>
                  <th className="text-left py-2">Trigger</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-border-soft last:border-0">
                    <td className="py-2 pr-3 text-xs">{new Date(r.started_at).toLocaleString()}</td>
                    <td className="py-2 pr-3">
                      <StatusPill variant={runStatusVariant(r.status)}>{r.status}</StatusPill>
                    </td>
                    <td className="py-2 pr-3">{r.instances_seen}</td>
                    <td className="py-2 pr-3 text-xs">
                      {Object.keys(r.actions_taken).length === 0 ? (
                        <span className="text-muted-foreground">none</span>
                      ) : (
                        Object.entries(r.actions_taken)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(', ')
                      )}
                    </td>
                    <td className="py-2">
                      <Badge variant="secondary">{r.trigger_source}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Events tail ───────────────────────────────────────────────────────────

function PoolerEventsCard({
  events,
}: {
  events: PoolerStatusResponse['recent_events'];
}): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent events</CardTitle>
        <CardDescription>
          Append-only log of reconciler actions + lifecycle events. Last 50 shown.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent events.</p>
        ) : (
          <ul className="space-y-1.5 max-h-[400px] overflow-y-auto pr-2">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-start gap-3 text-xs border-b border-border-soft pb-1.5 last:border-0"
              >
                <span className="text-muted-foreground whitespace-nowrap font-mono">
                  {new Date(e.created_at).toLocaleTimeString()}
                </span>
                <Badge variant="outline" className="font-mono whitespace-nowrap">
                  {e.event}
                </Badge>
                <span className="font-mono text-muted-foreground">{e.ref}</span>
                {e.detail ? (
                  <span
                    className="text-muted-foreground truncate"
                    title={JSON.stringify(e.detail, null, 2)}
                  >
                    {JSON.stringify(e.detail).slice(0, 80)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────

type PillVariant = 'success' | 'warn' | 'danger' | 'neutral';

function StatusPill({
  variant,
  children,
}: {
  variant: PillVariant;
  children: React.ReactNode;
}): React.ReactElement {
  const cls =
    variant === 'success'
      ? 'bg-success/15 text-success border-success/30'
      : variant === 'warn'
        ? 'bg-warning/15 text-warning border-warning/30'
        : variant === 'danger'
          ? 'bg-destructive/15 text-destructive border-destructive/30'
          : 'bg-muted text-muted-foreground border-border-soft';
  return (
    <span
      className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded border ${cls}`}
    >
      {children}
    </span>
  );
}

function tenantStatusVariant(s: string | null): PillVariant {
  if (!s) return 'neutral';
  if (s === 'active') return 'success';
  if (s === 'pg_password_drift') return 'danger';
  if (s === 'failed') return 'danger';
  if (s === 'registering') return 'warn';
  return 'neutral';
}

function runStatusVariant(s: string): PillVariant {
  if (s === 'success') return 'success';
  if (s === 'partial_failure') return 'warn';
  if (s === 'failed') return 'danger';
  if (s === 'running') return 'warn';
  return 'neutral';
}
