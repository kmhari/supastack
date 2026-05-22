import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { auditApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Shell } from '@/components/Shell';
import { PageHeader } from '@/components/PageHeader';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface AuditEntry {
  id: number;
  actorUserId: string | null;
  actorEmail: string | null;
  action: string;
  targetKind: string | null;
  targetId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function SettingsAuditPage(): React.ReactElement {
  const { user } = useAuth();
  const { data, isLoading } = useQuery<{ entries: AuditEntry[]; nextCursor: string | null }>({
    queryKey: ['audit'],
    queryFn: () =>
      auditApi.list({ limit: '100' }) as Promise<{
        entries: AuditEntry[];
        nextCursor: string | null;
      }>,
    enabled: user?.role === 'admin',
    refetchInterval: 15_000,
  });

  const [filter, setFilter] = useState('');
  const [targetFilter, setTargetFilter] = useState<'all' | string>('all');

  const entries = data?.entries ?? [];

  const targetKinds = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) if (e.targetKind) set.add(e.targetKind);
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    return entries
      .filter((e) => (targetFilter === 'all' ? true : e.targetKind === targetFilter))
      .filter((e) => {
        if (!filter) return true;
        const q = filter.toLowerCase();
        return (
          e.action.toLowerCase().includes(q) ||
          (e.actorEmail ?? '').toLowerCase().includes(q) ||
          (e.targetId ?? '').toLowerCase().includes(q)
        );
      });
  }, [entries, filter, targetFilter]);

  if (user && user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <Shell wide>
      <PageHeader
        title="Audit"
        subtitle="Destructive and security-sensitive actions across the org. Newest first."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-80">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by action, actor, or target id"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Select value={targetFilter} onValueChange={setTargetFilter}>
          <SelectTrigger className="h-8 border-dashed text-sm">
            <SelectValue placeholder="Target" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All targets</SelectItem>
            {targetKinds.map((k) => (
              <SelectItem key={k} value={k}>
                {k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {entries.length}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
        <div className="grid grid-cols-[180px_220px_200px_180px_1fr] gap-4 border-b border-border-soft px-6 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <div>When</div>
          <div>Actor</div>
          <div>Action</div>
          <div>Target</div>
          <div>Payload</div>
        </div>

        {isLoading ? (
          <p className="px-6 py-5 text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-5 text-muted-foreground">
            {entries.length === 0 ? 'No audit entries yet.' : 'No entries match your filter.'}
          </p>
        ) : (
          filtered.map((e, i) => (
            <div
              key={e.id}
              className={`grid grid-cols-[180px_220px_200px_180px_1fr] items-start gap-4 px-6 py-3 text-sm ${i > 0 ? 'border-t border-border-soft' : ''}`}
            >
              <div className="whitespace-nowrap text-muted-foreground">
                {new Date(e.createdAt).toLocaleString()}
              </div>
              <div className="truncate text-foreground">
                {e.actorEmail ?? <em className="text-muted-foreground">system/deleted</em>}
              </div>
              <div>
                <Badge variant="outline">{e.action}</Badge>
              </div>
              <div className="min-w-0">
                <div className="text-foreground">{e.targetKind ?? '—'}</div>
                {e.targetId && (
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {e.targetId}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                {Object.keys(e.payload).length > 0 && (
                  <code className="block break-all font-mono text-xs text-muted-foreground">
                    {JSON.stringify(e.payload)}
                  </code>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Shell>
  );
}
