import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi, type QueueHealth } from '@/lib/admin-api';
import { timeAgo } from '@/lib/format';
import { PageHeader, Empty } from '@/components/admin/Bits';
import { cn } from '@/lib/utils';

/** /admin/queues — background-job health (read-only; redacted failures). Feature 116 (US4). */
export function AdminQueues(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'queues'],
    queryFn: () => adminApi.queues(),
  });

  return (
    <div>
      <PageHeader title="Queues" sub="Background jobs (provision, backups, certs, …). Read-only." />
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : (data?.queues ?? []).length === 0 ? (
        <Empty>No queues reporting.</Empty>
      ) : (
        <div className="space-y-2">
          {data!.queues.map((qh) => (
            <QueueRow key={qh.name} qh={qh} />
          ))}
        </div>
      )}
    </div>
  );
}

function QueueRow({ qh }: { qh: QueueHealth }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const c = qh.counts;
  const hasFailures = c.failed > 0;
  return (
    <div className="rounded-md border border-default">
      <button
        type="button"
        onClick={() => hasFailures && setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between px-3 py-2 text-sm',
          hasFailures && 'cursor-pointer hover:bg-surface-100',
        )}
      >
        <span className="font-medium">{qh.name}</span>
        <span className="flex gap-3 text-xs text-foreground-light">
          <span>active {c.active}</span>
          <span>waiting {c.waiting}</span>
          <span className={cn(hasFailures && 'text-destructive-600')}>failed {c.failed}</span>
          <span className="text-foreground-lighter">done {c.completed}</span>
        </span>
      </button>
      {open && hasFailures && (
        <div className="border-t border-default bg-surface-100 px-3 py-2">
          {qh.recentFailures.map((f) => (
            <div key={f.id} className="py-1 text-xs">
              <span className="text-foreground-lighter">
                #{f.id} · {timeAgo(f.failedAt)} · attempt {f.attemptsMade} —{' '}
              </span>
              <span className="text-foreground-light">{f.failedReason || '(no reason)'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
