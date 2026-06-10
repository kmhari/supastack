import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import { timeAgo } from '@/lib/format';
import { PageHeader, StatusBadge, Empty, Th, Td } from '@/components/admin/Bits';

/** /admin/system — control-plane component health + version. Feature 116 (US2). */
export function AdminSystem(): React.ReactElement {
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'system'], queryFn: () => adminApi.system() });

  return (
    <div>
      <PageHeader title="System" sub="Control-plane components + deployed version." />
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs text-foreground-lighter">Version</div>
              <div>{data?.deployedCommit ?? '—'}</div>
            </div>
            <div>
              <div className="text-xs text-foreground-lighter">Sampled</div>
              <div>{timeAgo(data?.capturedAt)}</div>
            </div>
          </div>
          {(data?.components ?? []).length === 0 ? (
            <Empty>No control-plane samples yet (the observer writes these every ~60s).</Empty>
          ) : (
            <div className="rounded-md border border-default">
              <table className="w-full text-sm">
                <thead className="bg-surface-200">
                  <tr>
                    <Th>Container</Th>
                    <Th>Health</Th>
                    <Th>Status</Th>
                    <Th>Image</Th>
                  </tr>
                </thead>
                <tbody>
                  {data!.components.map((c) => (
                    <tr key={c.container} className="border-t border-default">
                      <Td>{c.container}</Td>
                      <Td>
                        <StatusBadge status={c.health ?? 'none'} />
                      </Td>
                      <Td className="text-foreground-light">{c.status ?? '—'}</Td>
                      <Td className="text-foreground-lighter">{c.image ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
