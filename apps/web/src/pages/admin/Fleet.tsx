import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import { Input } from '@/components/ui/input';
import { PageHeader, StatusBadge, Empty, Th, Td } from '@/components/admin/Bits';

/** /admin — installation-wide project list (scrollable + text filter for ≥50). Feature 116 (US2). */
export function AdminFleet(): React.ReactElement {
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'fleet'], queryFn: () => adminApi.fleet() });
  const [q, setQ] = useState('');
  const projects = (data?.projects ?? []).filter((p) =>
    `${p.ref} ${p.name} ${p.org} ${p.status}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div>
      <PageHeader title="Fleet" sub="Every project across the installation." />
      <Input
        placeholder="Filter projects…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-3 max-w-xs"
      />
      {isLoading ? (
        <Empty>Loading…</Empty>
      ) : projects.length === 0 ? (
        <Empty>{q ? 'No matching projects.' : 'No projects yet.'}</Empty>
      ) : (
        <div className="max-h-[70vh] overflow-auto rounded-md border border-default">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-200">
              <tr>
                <Th>Project</Th>
                <Th>Org</Th>
                <Th>Status</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.ref} className="border-t border-default hover:bg-surface-100">
                  <Td>
                    <Link to={`/admin/projects/${p.ref}`} className="text-brand-600">
                      {p.name || p.ref}
                    </Link>
                    <div className="text-xs text-foreground-lighter">{p.ref}</div>
                  </Td>
                  <Td>{p.org}</Td>
                  <Td>
                    <StatusBadge status={p.status} />
                  </Td>
                  <Td>{p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-foreground-lighter">{projects.length} project(s)</p>
    </div>
  );
}
