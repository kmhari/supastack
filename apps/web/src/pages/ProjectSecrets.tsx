import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { RESERVED_SECRETS } from '@selfbase/shared';
import { ProjectShell } from '@/components/ProjectShell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { secretsApi, type SecretListEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type DraftRow = { id: number; name: string; value: string; multiline: boolean };

let nextRowId = 1;
function makeRow(): DraftRow {
  return { id: nextRowId++, name: '', value: '', multiline: false };
}

export function ProjectSecretsPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const qc = useQueryClient();

  const { data: secrets = [], isLoading } = useQuery<SecretListEntry[]>({
    queryKey: ['project-secrets', ref],
    queryFn: () => secretsApi.list(ref),
    enabled: Boolean(ref),
  });

  const [draft, setDraft] = useState<DraftRow[]>([makeRow()]);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const upsertMutation = useMutation({
    mutationFn: (rows: Array<{ name: string; value: string }>) => secretsApi.upsert(ref, rows),
    onSuccess: () => {
      toast.success('Saved — propagation within 10s');
      setDraft([makeRow()]);
      qc.invalidateQueries({ queryKey: ['project-secrets', ref] });
    },
    onError: (err: unknown) => {
      const e = err as {
        response?: {
          data?: { error?: { code: string; message: string; details?: { name?: string } } };
        };
      };
      const msg = e?.response?.data?.error?.message ?? 'Failed to save secrets';
      const name = e?.response?.data?.error?.details?.name;
      toast.error(name ? `${msg} (${name})` : msg);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (name: string) => secretsApi.delete(ref, [name]),
    onSuccess: (_, name) => {
      toast.success(`Removed ${name}`);
      qc.invalidateQueries({ queryKey: ['project-secrets', ref] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response
        ?.data?.error?.message;
      toast.error(msg ?? 'Failed to delete secret');
    },
  });

  const filteredCustom = useMemo(() => {
    const q = search.toLowerCase();
    return secrets.filter((s) => !q || s.name.toLowerCase().includes(q));
  }, [secrets, search]);

  function handleSave(): void {
    const rows = draft
      .filter((r) => r.name.trim() !== '' || r.value !== '')
      .map((r) => ({ name: r.name.trim(), value: r.value }));
    if (rows.length === 0) {
      toast.error('Add at least one secret name + value');
      return;
    }
    // Client-side dedup: last value wins for any duplicate names.
    const dedup = new Map<string, string>();
    for (const r of rows) dedup.set(r.name, r.value);
    upsertMutation.mutate(Array.from(dedup, ([name, value]) => ({ name, value })));
  }

  function handlePasteEqualsLine(idx: number, raw: string): void {
    // Auto-split "KEY=value" pastes into name + value (UX nicety matching Cloud).
    const eq = raw.indexOf('=');
    if (eq > 0 && /^[A-Z][A-Z0-9_]*$/.test(raw.slice(0, eq))) {
      const next = [...draft];
      next[idx] = { ...next[idx]!, name: raw.slice(0, eq), value: raw.slice(eq + 1) };
      setDraft(next);
      return;
    }
    const next = [...draft];
    next[idx] = { ...next[idx]!, name: raw };
    setDraft(next);
  }

  return (
    <ProjectShell
      title="Secrets"
      subtitle="Environment variables available inside your edge functions via Deno.env.get(...). Backed by supabase_vault — saves propagate within ~5 seconds without restarting the functions container."
    >
      {/* Add or replace */}
      <section>
        <h2 className="m-0 mb-3 text-lg font-medium text-foreground">Add or replace secrets</h2>
        <Card className="p-5">
          {!isAdmin && (
            <p className="mb-4 rounded border border-border-soft bg-secondary/30 px-3 py-2 text-sm text-muted-foreground">
              You have read-only access. Ask an admin to set or delete secrets.
            </p>
          )}
          <div className="flex flex-col gap-3">
            {draft.map((row, idx) => (
              <div key={row.id} className="grid grid-cols-[1fr_2fr_auto] items-start gap-3">
                <Input
                  placeholder="SECRET_NAME"
                  value={row.name}
                  disabled={!isAdmin || upsertMutation.isPending}
                  onChange={(e) => handlePasteEqualsLine(idx, e.target.value)}
                  className="font-mono text-sm"
                />
                {row.multiline ? (
                  <Textarea
                    placeholder="value (multiline)"
                    value={row.value}
                    disabled={!isAdmin || upsertMutation.isPending}
                    onChange={(e) => {
                      const next = [...draft];
                      next[idx] = { ...next[idx]!, value: e.target.value };
                      setDraft(next);
                    }}
                    className="min-h-[80px] font-mono text-sm"
                  />
                ) : (
                  <Input
                    placeholder="value"
                    type="password"
                    value={row.value}
                    disabled={!isAdmin || upsertMutation.isPending}
                    onChange={(e) => {
                      const next = [...draft];
                      next[idx] = { ...next[idx]!, value: e.target.value };
                      setDraft(next);
                    }}
                    className="font-mono text-sm"
                  />
                )}
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={!isAdmin}
                    onClick={() => {
                      const next = [...draft];
                      next[idx] = { ...next[idx]!, multiline: !next[idx]!.multiline };
                      setDraft(next);
                    }}
                  >
                    {row.multiline ? 'Single' : 'Multi'}
                  </Button>
                  {draft.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!isAdmin}
                      onClick={() => setDraft(draft.filter((r) => r.id !== row.id))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isAdmin || upsertMutation.isPending}
              onClick={() => setDraft([...draft, makeRow()])}
            >
              <Plus className="size-4" /> Add another
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!isAdmin || upsertMutation.isPending}
              onClick={handleSave}
            >
              {upsertMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card>
      </section>

      {/* Custom secrets */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-lg font-medium text-foreground">Custom secrets</h2>
          <div className="relative w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Filter by name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <Card className="overflow-hidden p-0">
          <div className="grid grid-cols-[1fr_1fr_auto] gap-4 border-b border-border-soft px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <div>Name</div>
            <div>Digest (sha256)</div>
            <div className="w-8" />
          </div>
          {isLoading ? (
            <p className="px-5 py-4 text-muted-foreground">Loading…</p>
          ) : filteredCustom.length === 0 ? (
            <p className="px-5 py-4 text-muted-foreground">
              {secrets.length === 0
                ? 'No custom secrets yet. Add one above.'
                : 'No secrets match your filter.'}
            </p>
          ) : (
            filteredCustom.map((s, i) => (
              <div
                key={s.name}
                className={`grid grid-cols-[1fr_1fr_auto] items-center gap-4 px-5 py-3 text-sm ${i > 0 ? 'border-t border-border-soft' : ''}`}
              >
                <code className="font-mono text-foreground">{s.name}</code>
                <code className="truncate font-mono text-xs text-muted-foreground">
                  {s.value.slice(0, 16)}…
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!isAdmin}
                  onClick={() => setPendingDelete(s.name)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}
        </Card>
      </section>

      {/* Default / reserved */}
      <section>
        <h2 className="m-0 mb-3 text-lg font-medium text-foreground">Default secrets</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Managed by selfbase. Always available inside edge functions; you cannot set or replace
          them.
        </p>
        <Card className="overflow-hidden p-0">
          {RESERVED_SECRETS.map((r, i) => (
            <div
              key={r.name}
              className={`grid grid-cols-[200px_1fr_auto] items-center gap-4 px-5 py-2.5 text-sm ${i > 0 ? 'border-t border-border-soft' : ''}`}
            >
              <code className="font-mono text-foreground">{r.name}</code>
              <span className="text-muted-foreground">{r.description}</span>
              <Badge variant="outline">reserved</Badge>
            </div>
          ))}
        </Card>
      </section>

      <Dialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete secret</DialogTitle>
            <DialogDescription>
              Permanently remove <code className="font-mono">{pendingDelete}</code> from this
              project? Edge functions that read{' '}
              <code className="font-mono">{`Deno.env.get('${pendingDelete}')`}</code> will receive{' '}
              <code className="font-mono">undefined</code> within ~5 seconds.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (pendingDelete) deleteMutation.mutate(pendingDelete);
                setPendingDelete(null);
              }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ProjectShell>
  );
}
