import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import { formatBytes, timeAgo } from '@/lib/format';
import { PageHeader, StatusBadge, Empty, Th, Td } from '@/components/admin/Bits';
import { cn } from '@/lib/utils';

/** /admin/certs — TLS / DNS / backup status (read-only). Feature 116 (US5). */
export function AdminCerts(): React.ReactElement {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'certs'],
    queryFn: () => adminApi.certs(),
  });

  if (isLoading) return <Empty>Loading…</Empty>;
  if (!data) return <Empty>Unavailable.</Empty>;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cert / DNS / Backups"
        sub="TLS, DNS readiness, and backup status. Read-only."
      />

      <section>
        <h2 className="mb-2 text-sm font-medium">Wildcard certificate</h2>
        {!data.wildcard ? (
          <Empty>No wildcard certificate yet.</Empty>
        ) : (
          <div className="flex flex-wrap items-center gap-6 rounded-md border border-default bg-surface-200 p-3 text-sm">
            <span className="font-medium">*.{data.wildcard.apex}</span>
            <span className="text-foreground-light">expires {timeAgo(data.wildcard.notAfter)}</span>
            <span
              className={cn(
                data.wildcard.renewalWarning ? 'text-destructive-600' : 'text-foreground-light',
              )}
            >
              {data.wildcard.daysLeft ?? '—'} days left
              {data.wildcard.renewalWarning ? ' · renew soon' : ''}
            </span>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">DNS readiness</h2>
        <div className="flex gap-6 text-sm">
          <span>
            apex <StatusBadge status={data.dns.apexReady ? 'healthy' : 'unhealthy'} />
          </span>
          <span>
            wildcard <StatusBadge status={data.dns.wildcardReady ? 'healthy' : 'unhealthy'} />
          </span>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Per-project certificates</h2>
        {data.perProject.length === 0 ? (
          <Empty>No per-project certificates.</Empty>
        ) : (
          <div className="rounded-md border border-default">
            <table className="w-full text-sm">
              <thead className="bg-surface-200">
                <tr>
                  <Th>Project</Th>
                  <Th>Status</Th>
                  <Th>Expires</Th>
                  <Th>Days left</Th>
                </tr>
              </thead>
              <tbody>
                {data.perProject.map((c) => (
                  <tr key={c.ref} className="border-t border-default">
                    <Td>{c.ref}</Td>
                    <Td>
                      <StatusBadge status={c.status} />
                    </Td>
                    <Td>{timeAgo(c.notAfter)}</Td>
                    <Td>{c.daysLeft ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">
          Backups{' '}
          <span className="font-normal text-foreground-lighter">
            · {formatBytes(data.backups.totalStorageBytes)} total
          </span>
        </h2>
        {data.backups.perProject.length === 0 ? (
          <Empty>No backups recorded.</Empty>
        ) : (
          <div className="rounded-md border border-default">
            <table className="w-full text-sm">
              <thead className="bg-surface-200">
                <tr>
                  <Th>Project</Th>
                  <Th>Last backup</Th>
                  <Th>Size</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                {data.backups.perProject.map((b) => (
                  <tr key={b.ref} className="border-t border-default">
                    <Td>{b.ref}</Td>
                    <Td>{timeAgo(b.lastBackupAt)}</Td>
                    <Td>{formatBytes(b.sizeBytes)}</Td>
                    <Td>
                      <StatusBadge status={b.outcome} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
