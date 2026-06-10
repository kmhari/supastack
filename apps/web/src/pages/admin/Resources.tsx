import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/admin-api';
import { Input } from '@/components/ui/input';
import { formatBytes, pct } from '@/lib/format';
import { PageHeader, Empty, Th, Td } from '@/components/admin/Bits';

/** /admin/resources — host totals + per-project usage (scroll+filter) + disk + avg footprint. Feature 116 (US3). */
export function AdminResources(): React.ReactElement {
  const { data, isLoading } = useQuery({ queryKey: ['admin', 'resources'], queryFn: () => adminApi.resources() });
  const [q, setQ] = useState('');

  if (isLoading) return <Empty>Loading…</Empty>;
  if (!data || data.collecting || !data.host) {
    return (
      <div>
        <PageHeader title="Resources" />
        <Empty>Collecting samples — the observer writes the first metrics within ~60s.</Empty>
      </div>
    );
  }

  const projects = (data.projects ?? [])
    .filter((p) => p.ref.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.memUsedBytes ?? 0) - (a.memUsedBytes ?? 0));
  const d = data.host.disk;

  return (
    <div>
      <PageHeader title="Resources" sub="Host totals + per-project usage. Capacity = used vs free + average footprint." />

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="Host CPU" value={pct(data.host.cpuPct)} />
        <Stat label="Host memory" value={`${formatBytes(data.host.memUsedBytes)} / ${formatBytes(data.host.memLimitBytes)}`} />
        <Stat label="Disk free" value={formatBytes(d?.free)} />
        <Stat label="Avg / project" value={`${formatBytes(data.avgProjectFootprint?.memUsedBytes)} mem`} />
      </div>

      {d && (
        <div className="mb-5 text-sm">
          <div className="mb-1 text-xs text-foreground-lighter">Disk breakdown</div>
          <div className="flex gap-4 text-foreground-light">
            <span>project data {formatBytes(d.projectData)}</span>
            <span>backups {formatBytes(d.backups)}</span>
            <span>other {formatBytes(d.other)}</span>
            <span>free {formatBytes(d.free)}</span>
          </div>
        </div>
      )}

      <Input placeholder="Filter projects…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 max-w-xs" />
      <div className="max-h-[55vh] overflow-auto rounded-md border border-default">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-200">
            <tr>
              <Th>Project</Th>
              <Th>CPU</Th>
              <Th>Memory</Th>
              <Th>Disk</Th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.ref} className="border-t border-default">
                <Td>{p.ref}</Td>
                <Td>{pct(p.cpuPct)}</Td>
                <Td>{formatBytes(p.memUsedBytes)}</Td>
                <Td>{formatBytes(p.diskUsedBytes)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-md border border-default bg-surface-200 p-3">
      <div className="text-xs text-foreground-lighter">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}
