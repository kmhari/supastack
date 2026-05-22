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
            <Button size="sm" onClick={() => navigate('/dashboard/new')}>
              <Plus className="size-3" />
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
 * Card click goes to the project detail page on the platform domain.
 * Studio lives on the per-instance subdomain (Kong) and is reserved for
 * client-library API traffic — it isn't a UI entry point any more. Users
 * reach Studio explicitly from inside the project view if they want it.
 */
function ProjectCard({ row }: { row: InstanceRow }): React.ReactElement {
  const cardClasses =
    'group relative flex min-h-[200px] flex-col gap-1.5 rounded-lg border border-border-soft bg-card p-6 transition-colors hover:border-border';
  return (
    <Link to={`/dashboard/project/${row.ref}`} className={cn(cardClasses, 'no-underline')}>
      <div className="text-base font-medium text-foreground break-words">{row.name}</div>
      <div className="text-sm text-muted-foreground">
        Self-hosted {row.supabaseVersion ? `· ${row.supabaseVersion}` : ''}
      </div>
      <div className="mt-3">
        <StatusPill status={row.status} />
      </div>
    </Link>
  );
}

function ProjectList({ rows }: { rows: InstanceRow[] }): React.ReactElement {
  return (
    <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
      {rows.map((r, i) => (
        <Link
          key={r.ref}
          to={`/dashboard/project/${r.ref}`}
          className={cn(
            'grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3.5 text-foreground no-underline',
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
        </Link>
      ))}
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
