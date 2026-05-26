import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plug } from 'lucide-react';
import { toast } from 'sonner';
import { oauthApi, type OAuthClientRow } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { SettingsLayout } from '@/components/SettingsLayout';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Connected MCP clients — feature 014 US3.
 *
 * Lists every OAuth client (typically MCP-aware editors like Claude Code,
 * Cursor, Windsurf) that the current operator has authorized. Each row shows
 * the client name, authorized-at, last-used, scopes, and a Revoke action.
 *
 * Revocation propagates within 5s via the Redis revocation set (SC-004).
 */
export function SettingsMcpClientsPage(): React.ReactElement {
  const qc = useQueryClient();
  const { data: clients = [], isLoading } = useQuery<OAuthClientRow[]>({
    queryKey: ['oauth-clients'],
    queryFn: () => oauthApi.listClients(),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => oauthApi.revokeClient(id),
    onSuccess: (data, _id) => {
      toast.success(
        data.revoked > 0
          ? `Revoked ${data.revoked} grant${data.revoked === 1 ? '' : 's'}` +
              (data.blacklisted_jtis ? ` + ${data.blacklisted_jtis} live tokens` : '')
          : 'Already revoked',
      );
      qc.invalidateQueries({ queryKey: ['oauth-clients'] });
    },
    onError: (err) => toast.error(`Revoke failed: ${err instanceof Error ? err.message : err}`),
  });

  return (
    <Shell bare>
      <SettingsLayout>
        <PageHeader title="Connected MCP clients" />

        <Alert className="mb-4">
          <Plug className="size-4" />
          <AlertDescription>
            MCP-aware editors (Claude Code, Cursor, Windsurf, …) that you've authorized to drive
            your selfbase deployment. Revoke any client to immediately invalidate every active
            access token + refresh token for that client. Revocation takes effect within 5 seconds.
          </AlertDescription>
        </Alert>

        <div className="overflow-hidden rounded-lg border border-border-soft bg-card">
          <div className="grid grid-cols-[1fr_160px_180px_120px_80px] gap-4 border-b border-border-soft px-6 py-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            <div>Client</div>
            <div>Scope</div>
            <div>Last used</div>
            <div>Authorized</div>
            <div className="text-right">Action</div>
          </div>
          {isLoading ? (
            <p className="px-6 py-5 text-muted-foreground">Loading…</p>
          ) : clients.length === 0 ? (
            <div className="px-6 py-12 text-center text-muted-foreground">
              <Plug className="mx-auto mb-3 size-8 opacity-40" />
              <p>No MCP clients authorized yet.</p>
              <p className="mt-1 text-xs">
                Configure an MCP client with{' '}
                <code className="rounded bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px]">
                  https://mcp.&lt;your-apex&gt;/mcp
                </code>{' '}
                to start.
              </p>
            </div>
          ) : (
            clients.map((c, i) => (
              <div
                key={c.client_id}
                className={`grid grid-cols-[1fr_160px_180px_120px_80px] items-center gap-4 px-6 py-4 ${i > 0 ? 'border-t border-border-soft' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex size-7 items-center justify-center rounded-full border border-border bg-secondary/60">
                    <Plug className="size-3.5 text-muted-foreground" />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm text-foreground">{c.client_name}</span>
                    <code className="font-mono text-[10px] text-muted-foreground">
                      {c.client_id.slice(0, 8)}…
                    </code>
                  </div>
                </div>
                <div className="font-mono text-xs text-muted-foreground">{c.scope}</div>
                <div className="text-sm text-muted-foreground">
                  {new Date(c.last_used_at).toLocaleString()}
                </div>
                <div className="text-sm text-muted-foreground">
                  {new Date(c.authorized_at).toLocaleDateString()}
                </div>
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      if (
                        confirm(
                          `Revoke access for "${c.client_name}"?\n\nThis will immediately invalidate all tokens for this client. The next time it tries to call selfbase, it will need to re-authorize.`,
                        )
                      ) {
                        revoke.mutate(c.client_id);
                      }
                    }}
                    disabled={revoke.isPending}
                  >
                    <AlertTriangle className="size-3.5" />
                    Revoke
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </SettingsLayout>
    </Shell>
  );
}
