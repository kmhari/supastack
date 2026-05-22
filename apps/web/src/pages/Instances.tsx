import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDownUp,
  LayoutGrid,
  List,
  Package,
  Plus,
  Search,
  Settings,
} from 'lucide-react';
import { instancesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Shell } from '@/components/Shell';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface InstanceRow {
  ref: string;
  name: string;
  status: 'provisioning' | 'running' | 'paused' | 'stopped' | 'failed' | 'deleting';
  supabaseVersion?: string;
  urls: { kong: string | null; studio: string | null };
  createdAt: string;
}

type StatusFilter = 'all' | InstanceRow['status'];
type ViewMode = 'grid' | 'list';

export function InstancesPage(): React.ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [view, setView] = useState<ViewMode>('grid');

  const { data, isLoading, error } = useQuery<InstanceRow[]>({
    queryKey: ['instances'],
    queryFn: () => instancesApi.list() as Promise<InstanceRow[]>,
    refetchInterval: (q) => {
      const rows = (q.state.data as InstanceRow[] | undefined) ?? [];
      const transient = rows.some((r) => ['provisioning', 'deleting'].includes(r.status));
      return transient ? 3_000 : 15_000;
    },
  });

  const rows = useMemo(() => {
    const all = data ?? [];
    return all
      .filter((r) => (statusFilter === 'all' ? true : r.status === statusFilter))
      .filter((r) => (query ? r.name.toLowerCase().includes(query.toLowerCase()) : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [data, statusFilter, query]);

  const showNew = user?.role === 'admin';

  return (
    <Shell wide>
      <h1 className="mb-10 text-4xl font-normal tracking-tight text-foreground">Projects</h1>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a project"
            className="h-8 pl-8 text-sm"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="h-8 border-dashed text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
            <SelectItem value="provisioning">Provisioning</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="deleting">Deleting</SelectItem>
          </SelectContent>
        </Select>

        <span className="inline-flex h-8 items-center gap-1.5 px-3 text-sm text-foreground">
          <ArrowDownUp className="size-3 text-muted-foreground" />
          Sorted by name
        </span>

        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex gap-0.5">
            <Button
              variant={view === 'grid' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setView('grid')}
              aria-label="grid view"
            >
              <LayoutGrid className="size-3.5" />
            </Button>
            <Button
              variant={view === 'list' ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setView('list')}
              aria-label="list view"
            >
              <List className="size-3.5" />
            </Button>
          </div>
          {showNew && (
            <Button size="sm" onClick={() => navigate('/instances/new')}>
              <Plus className="size-3" />
              New project
            </Button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">Failed to load projects</p>}

      {data && rows.length === 0 && (
        <EmptyState role={user?.role ?? 'member'} onNew={() => navigate('/instances/new')} />
      )}

      {data && rows.length > 0 && view === 'grid' && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">
          {rows.map((r) => (
            <ProjectCard key={r.ref} row={r} />
          ))}
        </div>
      )}
      {data && rows.length > 0 && view === 'list' && <ProjectList rows={rows} />}
    </Shell>
  );
}

/**
 * A project card opens Studio directly in a new tab when the instance
 * is reachable. The settings icon in the corner takes the user to
 * selfbase's own detail page (/p/<ref>) for lifecycle, credentials,
 * and backups. If the instance can't be opened in Studio yet
 * (provisioning, no apex configured, paused, etc.) the whole card
 * falls back to the detail page so the user can see what's going on.
 */
/**
 * Card click goes to Studio whenever we have a URL — independent of
 * status. If the instance is paused/stopped/failed the browser will
 * show a connection error, which is the desired feedback (matches the
 * Supabase pattern: a project tile always opens its dashboard). The
 * gear icon is the way to reach selfbase's own settings page.
 *
 * Returns null only when there's no URL at all (no apex configured),
 * in which case the card falls back to /p/:ref so the user can see
 * why nothing is reachable yet.
 */
function studioHref(row: InstanceRow): string | null {
  return row.urls.kong ? `${row.urls.kong}/project/default` : null;
}

function ProjectCard({ row }: { row: InstanceRow }): React.ReactElement {
  const studio = studioHref(row);
  const cardClasses =
    'group relative flex min-h-[200px] flex-col gap-1.5 rounded-lg border border-border-soft bg-card p-6 transition-colors hover:border-border';
  const body = (
    <>
      <div className="flex items-start gap-2">
        <span className="flex-1 break-words text-base font-medium text-foreground">
          {row.name}
        </span>
        {/* Spacer where the settings button sits absolute-positioned */}
        <span className="size-8" aria-hidden />
      </div>
      <div className="text-sm text-muted-foreground">
        Self-hosted {row.supabaseVersion ? `· ${row.supabaseVersion}` : ''}
      </div>
      <div className="mt-3">
        <StatusPill status={row.status} />
      </div>
      <Link
        to={`/p/${row.ref}`}
        onClick={(e) => e.stopPropagation()}
        aria-label="Project settings"
        title="Project settings"
        className="absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-secondary hover:text-foreground"
      >
        <Settings className="size-4" />
      </Link>
    </>
  );

  if (studio) {
    return (
      <a
        href={studio}
        target="_blank"
        rel="noreferrer"
        className={cn(cardClasses, 'no-underline')}
      >
        {body}
      </a>
    );
  }
  return (
    <Link to={`/p/${row.ref}`} className={cn(cardClasses, 'no-underline')}>
      {body}
    </Link>
  );
}

function ProjectList({ rows }: { rows: InstanceRow[] }): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
      {rows.map((r, i) => {
        const studio = studioHref(r);
        const rowClasses = cn(
          'grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3.5 text-foreground no-underline',
          i > 0 && 'border-t border-border-soft',
        );
        const inner = (
          <>
            <div>
              <div className="text-sm font-medium text-foreground">{r.name}</div>
              <div className="text-xs text-muted-foreground">
                Self-hosted {r.supabaseVersion ? `· ${r.supabaseVersion}` : ''}
              </div>
            </div>
            <StatusPill status={r.status} />
            <Link
              to={`/p/${r.ref}`}
              onClick={(e) => e.stopPropagation()}
              aria-label="Project settings"
              title="Project settings"
              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Settings className="size-4" />
            </Link>
          </>
        );
        return studio ? (
          <a key={r.ref} href={studio} target="_blank" rel="noreferrer" className={rowClasses}>
            {inner}
          </a>
        ) : (
          <Link key={r.ref} to={`/p/${r.ref}`} className={rowClasses}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}

function EmptyState({
  role,
  onNew,
}: {
  role: string;
  onNew: () => void;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16">
      <Package className="size-8 text-foreground-light" />
      <h2 className="m-0 text-lg font-medium text-foreground">Create a project</h2>
      <p className="m-0 text-sm text-muted-foreground">
        Launch a complete backend built on Postgres.
      </p>
      {role === 'admin' && (
        <Button variant="secondary" size="sm" onClick={onNew} className="mt-2">
          <Plus className="size-3" />
          New project
        </Button>
      )}
    </div>
  );
}
