import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import { PageHeader, StatusBadge, Empty, Th, Td } from '@/components/admin/Bits';

/** /admin/projects/:ref — per-project health (read-only). Feature 116 (US2). */
export function AdminProjectDetail(): React.ReactElement {
  const { ref = '' } = useParams();
  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin', 'project', ref],
    queryFn: () => adminApi.project(ref),
  });

  return (
    <div>
      <Link to="/admin" className="text-sm text-foreground-light hover:text-foreground">
        ← Fleet
      </Link>
      <PageHeader title={ref} sub="Per-project services + database health." />
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : isError || !data ? (
        <Empty>Project not found or unavailable.</Empty>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-xs text-foreground-lighter">Status</div>
              <StatusBadge status={data.status} />
            </div>
            <div>
              <div className="text-xs text-foreground-lighter">Database</div>
              <StatusBadge status={data.database?.status} />
            </div>
            {data.version && (
              <div>
                <div className="text-xs text-foreground-lighter">Version</div>
                <div>{data.version}</div>
              </div>
            )}
          </div>
          <div className="rounded-md border border-default">
            <table className="w-full text-sm">
              <thead className="bg-surface-200">
                <tr>
                  <Th>Service</Th>
                  <Th>Health</Th>
                  <Th>Version</Th>
                </tr>
              </thead>
              <tbody>
                {(data.services ?? []).length === 0 ? (
                  <tr>
                    <Td className="text-foreground-lighter">No service data.</Td>
                    <Td>—</Td>
                    <Td>—</Td>
                  </tr>
                ) : (
                  data.services.map((s) => (
                    <tr key={s.name} className="border-t border-default">
                      <Td>{s.name}</Td>
                      <Td>
                        <StatusBadge status={s.healthy ? 'healthy' : 'unhealthy'} />
                      </Td>
                      <Td>{s.version ?? '—'}</Td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
