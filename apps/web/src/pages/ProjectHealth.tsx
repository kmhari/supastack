import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw } from 'lucide-react';
import { instancesApi } from '@/lib/api';
import { ProjectShell } from '@/components/ProjectShell';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Health = 'healthy' | 'unhealthy' | 'starting' | 'none';

interface Container {
  name: string;
  service: string;
  state: string;
  health: Health;
}

interface HealthResponse {
  ref: string;
  status: string;
  containers: Container[];
  summary: {
    healthy: number;
    unhealthy: number;
    starting: number;
    none: number;
    running: number;
    total: number;
  };
  generatedAt: string;
}

const POLL_MS = 5000;

export function ProjectHealthPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();

  const query = useQuery<HealthResponse>({
    queryKey: ['instances', ref, 'health'],
    queryFn: () => instancesApi.health(ref) as Promise<HealthResponse>,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });

  return (
    <ProjectShell
      title="Health"
      subtitle="Live status of every container that makes up this project."
    >
      <PulseBar
        generatedAt={query.data?.generatedAt}
        isFetching={query.isFetching}
        onRefresh={() => void query.refetch()}
      />

      <SummaryStrip summary={query.data?.summary} loading={query.isLoading} />

      <ContainerList
        containers={query.data?.containers ?? []}
        loading={query.isLoading}
        error={query.error as Error | null}
      />
    </ProjectShell>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Pulse bar — the live polling indicator                                     */
/* ────────────────────────────────────────────────────────────────────────── */

function PulseBar({
  generatedAt,
  isFetching,
  onRefresh,
}: {
  generatedAt?: string;
  isFetching: boolean;
  onRefresh: () => void;
}): React.ReactElement {
  const [, force] = useState(0);
  // re-render every second so "X seconds ago" stays fresh
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const ago = useMemo(() => {
    if (!generatedAt) return '—';
    const s = Math.max(0, Math.floor((Date.now() - new Date(generatedAt).getTime()) / 1000));
    if (s < 1) return 'just now';
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
  }, [generatedAt]);

  return (
    <div className="flex items-center justify-between gap-4 border-y border-border-soft bg-card/40 px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <LiveDot color="success" pulsing={isFetching} />
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {isFetching ? 'polling' : 'live'}
        </span>
        <span className="h-3 w-px bg-border" />
        <span className="text-xs text-muted-foreground">
          Last updated <span className="text-foreground-light">{ago}</span> · auto every{' '}
          {POLL_MS / 1000}s
        </span>
      </div>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={isFetching}>
        <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
        Refresh
      </Button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Summary strip — three big numerals, hairline-divided                       */
/* ────────────────────────────────────────────────────────────────────────── */

function SummaryStrip({
  summary,
  loading,
}: {
  summary?: HealthResponse['summary'];
  loading: boolean;
}): React.ReactElement {
  const cells: { label: string; value: number; tone: 'success' | 'danger' | 'warn' | 'muted' }[] = [
    { label: 'Healthy', value: summary?.healthy ?? 0, tone: 'success' },
    { label: 'Unhealthy', value: summary?.unhealthy ?? 0, tone: 'danger' },
    { label: 'Starting', value: summary?.starting ?? 0, tone: 'warn' },
    { label: 'No probe', value: summary?.none ?? 0, tone: 'muted' },
  ];
  return (
    <div className="grid grid-cols-4 overflow-hidden rounded-md border border-border-soft bg-card">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={cn(
            'relative flex flex-col items-start gap-1 px-5 py-5',
            i > 0 && 'border-l border-border-soft',
          )}
        >
          <span
            className={cn(
              'font-mono text-[10px] uppercase tracking-[0.18em]',
              c.tone === 'success' && 'text-success',
              c.tone === 'danger' && 'text-danger',
              c.tone === 'warn' && 'text-warn',
              c.tone === 'muted' && 'text-muted-foreground',
            )}
          >
            {c.label}
          </span>
          <span
            className={cn(
              'font-mono text-[34px] font-medium leading-none tabular-nums tracking-tight text-foreground',
              loading && 'opacity-30',
            )}
            style={{ fontVariantNumeric: 'tabular-nums slashed-zero' }}
          >
            {loading ? '—' : c.value}
          </span>
          {/* subtle accent rail on the active column */}
          {c.value > 0 && !loading && (
            <span
              className={cn(
                'absolute inset-x-0 bottom-0 h-px',
                c.tone === 'success' && 'bg-success/70',
                c.tone === 'danger' && 'bg-danger/70',
                c.tone === 'warn' && 'bg-warn/70',
                c.tone === 'muted' && 'bg-muted-foreground/40',
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Container list — borderless table with row reveal + colored leading bar    */
/* ────────────────────────────────────────────────────────────────────────── */

function ContainerList({
  containers,
  loading,
  error,
}: {
  containers: Container[];
  loading: boolean;
  error: Error | null;
}): React.ReactElement {
  if (error) {
    return (
      <div className="rounded-md border border-danger/40 bg-danger/5 px-5 py-4 text-sm text-danger">
        Failed to load container health: {error.message}
      </div>
    );
  }
  if (loading) return <SkeletonList />;
  if (containers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border-soft bg-card/30 px-6 py-14 text-center">
        <Activity className="size-6 text-muted-foreground/60" strokeWidth={1.4} />
        <div className="text-sm text-foreground-light">No containers running yet</div>
        <div className="max-w-sm text-xs text-muted-foreground">
          This project hasn&apos;t been provisioned, or its containers were removed. Check the
          provision queue or restart the instance from General.
        </div>
      </div>
    );
  }
  // sort: unhealthy first, then starting, then healthy/none alphabetical
  const sorted = [...containers].sort((a, b) => {
    const w: Record<Health, number> = { unhealthy: 0, starting: 1, none: 2, healthy: 3 };
    if (w[a.health] !== w[b.health]) return w[a.health] - w[b.health];
    return a.service.localeCompare(b.service);
  });

  return (
    <div className="overflow-hidden rounded-md border border-border-soft bg-card">
      <div className="grid grid-cols-[3px_1fr_auto_auto] items-center border-b border-border-soft bg-card/60 px-0 py-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        <span />
        <span className="pl-5">Service</span>
        <span className="pr-6">State</span>
        <span className="pr-5">Health</span>
      </div>
      {sorted.map((c, i) => (
        <ContainerRow key={c.name} c={c} i={i} />
      ))}
    </div>
  );
}

function ContainerRow({ c, i }: { c: Container; i: number }): React.ReactElement {
  const tone =
    c.health === 'healthy'
      ? 'success'
      : c.health === 'unhealthy'
        ? 'danger'
        : c.health === 'starting'
          ? 'warn'
          : 'muted';

  return (
    <div
      className="grid grid-cols-[3px_1fr_auto_auto] items-stretch border-b border-border-soft/60 last:border-b-0 hover:bg-secondary/30"
      style={{
        animation: 'supastack-row-in 240ms ease-out both',
        animationDelay: `${i * 30}ms`,
      }}
    >
      {/* leading colored rail */}
      <span
        className={cn(
          'h-full',
          tone === 'success' && 'bg-success/80',
          tone === 'danger' && 'bg-danger/80',
          tone === 'warn' && 'bg-warn/80',
          tone === 'muted' && 'bg-muted-foreground/30',
        )}
      />
      <div className="flex flex-col gap-0.5 px-5 py-3">
        <span className="text-sm font-medium text-foreground">{c.service}</span>
        <span className="font-mono text-[11px] text-muted-foreground">{c.name}</span>
      </div>
      <div className="flex items-center pr-6">
        <StateBadge state={c.state} />
      </div>
      <div className="flex items-center pr-5">
        <HealthBadge health={c.health} />
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Atoms                                                                       */
/* ────────────────────────────────────────────────────────────────────────── */

function LiveDot({
  color,
  pulsing,
}: {
  color: 'success' | 'danger' | 'warn' | 'muted';
  pulsing?: boolean;
}): React.ReactElement {
  const bg =
    color === 'success'
      ? 'bg-success'
      : color === 'danger'
        ? 'bg-danger'
        : color === 'warn'
          ? 'bg-warn'
          : 'bg-muted-foreground';
  const ring =
    color === 'success'
      ? 'bg-success/60'
      : color === 'danger'
        ? 'bg-danger/60'
        : color === 'warn'
          ? 'bg-warn/60'
          : 'bg-muted-foreground/50';
  return (
    <span className="relative inline-flex size-2 items-center justify-center">
      {pulsing && (
        <span
          aria-hidden
          className={cn('absolute inset-0 rounded-full', ring)}
          style={{ animation: 'supastack-pulse 1.4s ease-in-out infinite' }}
        />
      )}
      <span className={cn('relative inline-block size-2 rounded-full', bg)} />
    </span>
  );
}

function HealthBadge({ health }: { health: Health }): React.ReactElement {
  const label = health === 'none' ? 'no probe' : health;
  const tone =
    health === 'healthy'
      ? 'success'
      : health === 'unhealthy'
        ? 'danger'
        : health === 'starting'
          ? 'warn'
          : 'muted';

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em]',
        tone === 'success' &&
          'border-success/30 bg-success/10 text-success shadow-[0_0_0_1px_rgba(62,207,142,0.04),0_0_22px_-8px_rgba(62,207,142,0.55)]',
        tone === 'danger' &&
          'border-danger/40 bg-danger/10 text-danger shadow-[0_0_0_1px_rgba(220,38,38,0.05),0_0_22px_-8px_rgba(220,38,38,0.55)]',
        tone === 'warn' && 'border-warn/40 bg-warn/10 text-warn',
        tone === 'muted' && 'border-border bg-secondary text-muted-foreground',
      )}
    >
      <LiveDot color={tone} pulsing={health === 'healthy' || health === 'starting'} />
      {label}
    </span>
  );
}

function StateBadge({ state }: { state: string }): React.ReactElement {
  const isRunning = state === 'running';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] lowercase',
        isRunning
          ? 'border-border bg-secondary/60 text-foreground-light'
          : 'border-danger/30 bg-danger/5 text-danger',
      )}
    >
      {state}
    </span>
  );
}

function SkeletonList(): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-md border border-border-soft bg-card">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="grid grid-cols-[3px_1fr_auto_auto] items-center border-b border-border-soft/60 last:border-b-0"
        >
          <span className="h-full bg-muted-foreground/10" />
          <div className="flex flex-col gap-1.5 px-5 py-4">
            <ShimmerBar width="40%" />
            <ShimmerBar width="68%" />
          </div>
          <div className="pr-6">
            <ShimmerBar width="60px" />
          </div>
          <div className="pr-5">
            <ShimmerBar width="78px" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ShimmerBar({ width }: { width: string }): React.ReactElement {
  return (
    <span
      className="block h-2.5 rounded-sm"
      style={{
        width,
        background:
          'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 100%)',
        backgroundSize: '200px 100%',
        backgroundRepeat: 'no-repeat',
        animation: 'supastack-shimmer 1.4s linear infinite',
      }}
    />
  );
}
