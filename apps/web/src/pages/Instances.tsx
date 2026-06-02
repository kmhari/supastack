import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowDownUp, LayoutGrid, List, Package, Plus, Search, Settings } from 'lucide-react';
import { Link } from 'react-router-dom';
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
type SortMode = 'name' | 'created_desc' | 'created_asc' | 'status';
type ViewMode = 'grid' | 'list';

export function InstancesPage(): React.ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortMode>('name');
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
    const filtered = all
      .filter((r) => (statusFilter === 'all' ? true : r.status === statusFilter))
      .filter((r) => (query ? r.name.toLowerCase().includes(query.toLowerCase()) : true));
    const cmp: Record<SortMode, (a: InstanceRow, b: InstanceRow) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      created_desc: (a, b) => b.createdAt.localeCompare(a.createdAt),
      created_asc: (a, b) => a.createdAt.localeCompare(b.createdAt),
      status: (a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name),
    };
    return [...filtered].sort(cmp[sort]);
  }, [data, statusFilter, query, sort]);

  const showNew = user?.role === 'admin';

  return (
    <Shell wide>
      <h1 className="mb-10 text-4xl font-normal tracking-tight text-foreground">Projects</h1>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search for a project"
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[160px]">
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

        <Select value={sort} onValueChange={(v) => setSort(v as SortMode)}>
          <SelectTrigger className="w-[180px]">
            <ArrowDownUp className="size-3.5 text-muted-foreground" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Name (A → Z)</SelectItem>
            <SelectItem value="created_desc">Newest first</SelectItem>
            <SelectItem value="created_asc">Oldest first</SelectItem>
            <SelectItem value="status">Status</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex gap-0.5">
            <Button
              type={view === 'grid' ? 'default' : 'text'}
              size="tiny"
              onClick={() => setView('grid')}
              aria-label="grid view"
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              type={view === 'list' ? 'default' : 'text'}
              size="tiny"
              onClick={() => setView('list')}
              aria-label="list view"
            >
              <List className="size-4" />
            </Button>
          </div>
          {showNew && (
            <Button onClick={() => navigate('/dashboard/new')}>
              <Plus className="size-4" />
              New project
            </Button>
          )}
        </div>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {error && <p className="text-destructive">Failed to load projects</p>}

      {data && rows.length === 0 && (
        <EmptyState role={user?.role ?? 'member'} onNew={() => navigate('/dashboard/new')} />
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
 * Card click opens Studio at the project's own subdomain
 * (studio-<ref>.<apex>) via a same-tab full-page navigation. Studio is
 * cross-origin from the apex supastack shell, so we use a plain <a> rather
 * than react-router's <Link>. Falls back to the supastack admin page if the
 * API hasn't returned a urls.studio yet (e.g. apex not configured).
 */
function ProjectCard({ row }: { row: InstanceRow }): React.ReactElement {
  const href = row.urls.studio ?? `/dashboard/project/${row.ref}`;
  const cardClasses =
    'group relative flex flex-col gap-1.5 rounded-lg border border-border-soft bg-card p-5 transition-colors hover:border-border';
  // Avoid nested <a> by placing the studio link as a fully-positioned overlay
  // BEHIND the Settings link, with pointer-events: auto, so clicks on the
  // card surface (but NOT on the Settings icon) navigate to Studio. React's
  // validateDOMNesting fires on <a> inside <a>; the overlay pattern keeps
  // both targets clickable without nesting them.
  return (
    <div className={cardClasses}>
      <a
        href={href}
        aria-label={`Open ${row.name} in Studio`}
        className="absolute inset-0 z-0 rounded-lg no-underline"
      />
      <div className="pointer-events-none relative z-10 text-base font-medium text-foreground break-words pr-8">
        {row.name}
      </div>
      <div className="pointer-events-none relative z-10 text-sm text-muted-foreground">
        Self-hosted {row.supabaseVersion ? `· ${row.supabaseVersion}` : ''}
      </div>
      <div className="pointer-events-none relative z-10 mt-3">
        <StatusPill status={row.status} />
      </div>
      <Link
        to={`/dashboard/project/${row.ref}`}
        aria-label={`${row.name} settings`}
        className="absolute right-3 top-3 z-20 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Settings className="size-4" />
      </Link>
    </div>
  );
}

function ProjectList({ rows }: { rows: InstanceRow[] }): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
      {rows.map((r, i) => {
        const href = r.urls.studio ?? `/dashboard/project/${r.ref}`;
        return (
          <a
            key={r.ref}
            href={href}
            className={cn(
              'grid grid-cols-[1fr_auto_auto] items-center gap-4 px-5 py-3.5 text-foreground no-underline',
              i > 0 && 'border-t border-border-soft',
            )}
          >
            <div>
              <div className="text-sm font-medium text-foreground">{r.name}</div>
              <div className="text-xs text-muted-foreground">
                Self-hosted {r.supabaseVersion ? `· ${r.supabaseVersion}` : ''}
              </div>
            </div>
            <StatusPill status={r.status} />
            <Link
              to={`/dashboard/project/${r.ref}`}
              aria-label={`${r.name} settings`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Settings className="size-4" />
            </Link>
          </a>
        );
      })}
    </div>
  );
}

function EmptyState({ role, onNew }: { role: string; onNew: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16">
      <Package className="size-8 text-foreground-light" />
      <h2 className="m-0 text-lg font-medium text-foreground">Create a project</h2>
      <p className="m-0 text-sm text-muted-foreground">
        Launch a complete backend built on Postgres.
      </p>
      {role === 'admin' && (
        <Button type="default" size="small" onClick={onNew} className="mt-2">
          <Plus className="size-3" />
          New project
        </Button>
      )}
    </div>
  );
}
