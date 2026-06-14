import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { timeAgo } from '@/lib/format';
import { PageHeader, Empty } from '@/components/admin/Bits';
import { cn } from '@/lib/utils';

const CONTROL_PLANE = [
  'supastack-api-1',
  'supastack-worker-1',
  'supastack-db-1',
  'supastack-caddy-1',
  'supastack-supavisor-1',
  'supastack-mcp-1',
];

/** /admin/logs — recent logs for a selectable source (project or control-plane). Feature 116 (US2). */
export function AdminLogs(): React.ReactElement {
  const [source, setSource] = useState('control-plane:supastack-api-1');
  const [draft, setDraft] = useState('');
  const { data, isFetching, refetch } = useQuery({
    queryKey: ['admin', 'logs', source],
    queryFn: () => adminApi.logs(source),
    enabled: !!source,
  });

  return (
    <div>
      <PageHeader title="Logs" sub="Recent entries (control-plane ~60s; project on demand)." />

      <div className="mb-2 flex flex-wrap gap-1">
        {CONTROL_PLANE.map((c) => {
          const src = `control-plane:${c}`;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setSource(src)}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors',
                source === src
                  ? 'bg-surface-300 text-foreground'
                  : 'text-foreground-light hover:text-foreground',
              )}
            >
              {c.replace('supastack-', '').replace('-1', '')}
            </button>
          );
        })}
      </div>

      <form
        className="mb-3 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft) setSource(draft);
        }}
      >
        <Input
          placeholder="project:<ref>:api  (or control-plane:<container>)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="max-w-md"
        />
        <Button htmlType="submit" type="default" size="tiny">
          Load
        </Button>
      </form>

      <div className="mb-2 flex items-center gap-3 text-xs text-foreground-lighter">
        <span>{source}</span>
        <span>{data ? (data.fresh ? 'live' : `~${timeAgo(data.capturedAt)}`) : ''}</span>
        <button type="button" onClick={() => refetch()} className="hover:text-foreground">
          {isFetching ? 'refreshing…' : 'refresh'}
        </button>
      </div>

      {!data || data.lines.length === 0 ? (
        <Empty>No log lines for this source.</Empty>
      ) : (
        <pre className="max-h-[60vh] overflow-auto rounded-md border border-default bg-surface-100 p-3 text-xs leading-relaxed text-foreground-light">
          {data.lines.join('\n')}
        </pre>
      )}
    </div>
  );
}
