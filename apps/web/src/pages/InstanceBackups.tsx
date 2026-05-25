import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { backupsApi, instancesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { ProjectShell } from '@/components/ProjectShell';
import { StatusPill } from '@/components/StatusPill';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface BackupRow {
  id: string;
  kind: 'manual' | 'auto';
  status: 'running' | 'completed' | 'failed';
  storeKind: 'local' | 's3';
  sizeBytes: number | null;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  downloadUrl: string | null;
}

export function InstanceBackupsPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const { data: backups = [], isLoading } = useQuery<BackupRow[]>({
    queryKey: ['instance-backups', ref],
    queryFn: () => backupsApi.list(ref) as Promise<BackupRow[]>,
    refetchInterval: (q) => {
      const rows = (q.state.data as BackupRow[] | undefined) ?? [];
      return rows.some((r) => r.status === 'running') ? 3_000 : 30_000;
    },
  });

  const { data: instance } = useQuery<{
    backupAutoEnabled: boolean;
    backupRetain: number;
    name: string;
  }>({
    queryKey: ['instances', ref],
    queryFn: () => instancesApi.get(ref) as Promise<never>,
  });

  const createBackup = useMutation({
    mutationFn: () => backupsApi.create(ref),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instance-backups', ref] }),
  });

  const [autoOn, setAutoOn] = useState<boolean | null>(null);
  const [retain, setRetain] = useState<number | null>(null);
  const effectiveAuto = autoOn ?? instance?.backupAutoEnabled ?? true;
  const effectiveRetain = retain ?? instance?.backupRetain ?? 7;

  const saveConfig = useMutation({
    mutationFn: () =>
      instancesApi.patch(ref, { backupAutoEnabled: effectiveAuto, backupRetain: effectiveRetain }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances', ref] }),
  });

  return (
    <ProjectShell
      title="Backups"
      subtitle={
        isAdmin
          ? 'Daily auto-backup with rolling retention. Manual snapshots on demand.'
          : 'Backup history for this project.'
      }
    >
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => createBackup.mutate()} disabled={createBackup.isPending}>
            <Plus className="size-3.5" />
            {createBackup.isPending ? 'Creating…' : 'Create backup'}
          </Button>
        </div>
      )}

      {isAdmin && (
        <Card className="mb-5">
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Daily auto-backup with rolling retention.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-6">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-foreground">
                <Checkbox checked={effectiveAuto} onCheckedChange={(v) => setAutoOn(v === true)} />
                Daily auto-backup
              </label>
              <div className="inline-flex items-center gap-2 text-sm text-foreground">
                <span>Retain last</span>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={effectiveRetain}
                  onChange={(e) => setRetain(Number(e.target.value))}
                  className="w-20"
                />
                <span>backups</span>
              </div>
              <Button
                variant="outline"
                onClick={() => saveConfig.mutate()}
                disabled={saveConfig.isPending}
              >
                {saveConfig.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden p-0">
        <CardHeader className="px-6 py-5">
          <CardTitle>Backup history</CardTitle>
        </CardHeader>
        {isLoading ? (
          <p className="px-6 pb-6 text-muted-foreground">Loading…</p>
        ) : backups.length === 0 ? (
          <p className="px-6 pb-6 text-muted-foreground">No backups yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Store</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(b.startedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{b.kind}</TableCell>
                  <TableCell>
                    <StatusPill status={b.status} />
                    {b.error && <div className="mt-1 text-xs text-destructive">{b.error}</div>}
                  </TableCell>
                  <TableCell>{b.sizeBytes ? formatBytes(b.sizeBytes) : '—'}</TableCell>
                  <TableCell>{b.storeKind}</TableCell>
                  <TableCell>
                    {b.downloadUrl && (
                      <a
                        href={b.downloadUrl}
                        className="text-sm text-success no-underline hover:underline"
                      >
                        <Download className="inline size-3" /> Download
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </ProjectShell>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
