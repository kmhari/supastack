import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, KeyRound, MoreVertical, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { authApi } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { PageHeader } from '@/components/PageHeader';
import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Token {
  id: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export function SettingsTokensPage(): React.ReactElement {
  const qc = useQueryClient();
  const { data: tokens = [], isLoading } = useQuery<Token[]>({
    queryKey: ['tokens'],
    queryFn: () => authApi.listTokens() as Promise<Token[]>,
  });

  const [filter, setFilter] = useState('');
  const filtered = useMemo(
    () =>
      tokens.filter((t) =>
        filter ? t.label.toLowerCase().includes(filter.toLowerCase()) : true,
      ),
    [tokens, filter],
  );

  const [createOpen, setCreateOpen] = useState(false);

  const revoke = useMutation({
    mutationFn: (id: string) => authApi.revokeToken(id),
    onSuccess: () => {
      toast.success('Token revoked');
      qc.invalidateQueries({ queryKey: ['tokens'] });
    },
  });

  return (
    <Shell wide>
      <PageHeader title="Tokens" />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter tokens"
            className="h-8 pl-8 text-sm"
          />
        </div>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" />
            Create token
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
        <div className="grid grid-cols-[1fr_180px_220px_60px] gap-4 border-b border-border-soft px-6 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <div>Label</div>
          <div>Created</div>
          <div>Last used</div>
          <div />
        </div>
        {isLoading ? (
          <p className="px-6 py-5 text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="px-6 py-5 text-muted-foreground">
            {filter ? 'No tokens match your filter.' : 'No tokens yet — create one to use the API.'}
          </p>
        ) : (
          filtered.map((t, i) => (
            <div
              key={t.id}
              className={`grid grid-cols-[1fr_180px_220px_60px] items-center gap-4 px-6 py-4 ${i > 0 ? 'border-t border-border-soft' : ''}`}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center rounded-full border border-border bg-secondary/60">
                  <KeyRound className="size-3.5 text-muted-foreground" />
                </span>
                <span className="text-sm text-foreground">{t.label}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                {new Date(t.createdAt).toLocaleDateString()}
              </div>
              <div className="text-sm text-muted-foreground">
                {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never'}
              </div>
              <div className="flex justify-end">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon-sm" aria-label="token actions">
                      <MoreVertical className="size-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={(e) => {
                        e.preventDefault();
                        if (confirm(`Revoke "${t.label}"? Cannot be undone.`))
                          revoke.mutate(t.id);
                      }}
                    >
                      Revoke token
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))
        )}
      </div>

      <CreateTokenDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => qc.invalidateQueries({ queryKey: ['tokens'] })}
      />
    </Shell>
  );
}

function CreateTokenDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}): React.ReactElement {
  const [label, setLabel] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: { label: string }) => authApi.createToken(body),
    onSuccess: (data) => {
      const d = data as { id: string; token: string; label: string };
      setToken(d.token);
      onSuccess();
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      setError(e.response?.data?.error?.message ?? 'failed to create token');
    },
  });

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (!label.trim()) return;
    setError(null);
    create.mutate({ label: label.trim() });
  };

  const reset = (): void => {
    setLabel('');
    setToken(null);
    setError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{token ? 'Save your token' : 'Create token'}</DialogTitle>
          <DialogDescription>
            {token
              ? "Shown once and never again — save it now."
              : 'Personal bearer token for CLI / scripts. Treat like a password.'}
          </DialogDescription>
        </DialogHeader>

        {!token ? (
          <form onSubmit={onSubmit} className="grid gap-4">
            <div>
              <Label htmlFor="token-label" className="mb-1.5 block text-sm text-foreground-light">
                Label
              </Label>
              <Input
                id="token-label"
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="ci-deploy"
                autoFocus
              />
            </div>
            {error && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create token'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="grid gap-3">
            <Alert variant="warn">
              <AlertTriangle />
              <AlertDescription>
                <code className="mt-1 block break-all rounded border border-border-soft bg-background p-2 font-mono text-xs text-success">
                  {token}
                </code>
              </AlertDescription>
            </Alert>
            <div className="flex justify-end gap-2">
              <CopyButton value={token} label="Copy token" variant="outline" />
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
