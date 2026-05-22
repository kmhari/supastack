import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, Download, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { cliApi } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { PageHeader } from '@/components/PageHeader';
import { CopyButton } from '@/components/CopyButton';
import { CliCommandBlock } from '@/components/CliCommandBlock';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * "Connect a Supabase CLI" page — landing surface for new CLI users.
 *
 * Spec: FR-002. Shows three steps:
 *   1. Save the selfbase.toml profile
 *   2. Mint a PAT (revealed ONCE)
 *   3. Run the three canonical commands
 *
 * The deploy command shown does NOT include `--use-api` — both deploy paths
 * are supported per research.md R-002. A footnote mentions the fallback.
 */
export function ConnectCliPage(): React.ReactElement {
  const { data: toml, isLoading: tomlLoading } = useQuery<string>({
    queryKey: ['cli-profile-toml'],
    queryFn: () => cliApi.profileToml(),
  });

  const [tokenOpen, setTokenOpen] = useState(false);
  const [revealedToken, setRevealedToken] = useState<{
    token: string;
    prefix: string;
  } | null>(null);

  const mint = useMutation({
    mutationFn: () => cliApi.mintToken(),
    onSuccess: (data) => {
      setRevealedToken({ token: data.token, prefix: data.prefix });
      setTokenOpen(true);
      toast.success('Token created — copy it now, it cannot be shown again.');
    },
    onError: (err: unknown) => {
      toast.error('Failed to create token: ' + (err as Error).message);
    },
  });

  const downloadToml = () => {
    if (!toml) return;
    const blob = new Blob([toml], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'selfbase.toml';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Use a stable example ref in the link command — real users sub in their own.
  const exampleRef = 'your-project-ref';

  return (
    <Shell>
      <PageHeader
        title="Connect a Supabase CLI"
        subtitle="Use the unmodified upstream supabase CLI against this selfbase deployment."
      />

      {/* Step 1 */}
      <section className="mb-10">
        <h2 className="m-0 mb-3 text-lg font-medium text-foreground">
          Step 1 &mdash; Save the profile
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Save the snippet below to a stable location on your machine (e.g.
          <code className="mx-1 rounded bg-secondary px-1 py-0.5 font-mono text-xs">
            ~/.supabase/profiles/selfbase.toml
          </code>
          ). The CLI selects it later with <code className="mx-1 font-mono text-xs">--profile</code>.
        </p>
        <div className="mb-3 rounded-md border border-border-soft bg-card">
          <pre className="m-0 overflow-x-auto p-4 font-mono text-xs text-foreground">
            {tomlLoading ? 'Loading…' : (toml ?? '# (no apex configured yet)')}
          </pre>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={downloadToml} disabled={!toml}>
            <Download className="size-3.5" />
            Download selfbase.toml
          </Button>
          {toml && <CopyButton value={toml} label="Copy" />}
        </div>
      </section>

      {/* Step 2 */}
      <section className="mb-10">
        <h2 className="m-0 mb-3 text-lg font-medium text-foreground">
          Step 2 &mdash; Mint a personal access token
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Click below to create a new token bound to your account. The plaintext
          is shown <span className="font-medium text-foreground">once</span> &mdash;
          copy it immediately. You can revoke it any time from the{' '}
          <a href="/settings/tokens" className="underline">
            Tokens
          </a>{' '}
          page.
        </p>
        <Button onClick={() => mint.mutate()} disabled={mint.isPending}>
          <KeyRound className="size-3.5" />
          {mint.isPending ? 'Creating…' : 'Create CLI token'}
        </Button>
      </section>

      {/* Step 3 */}
      <section className="mb-10">
        <h2 className="m-0 mb-3 text-lg font-medium text-foreground">
          Step 3 &mdash; Use the CLI
        </h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Run these three commands. After step 1 your <code className="mx-1 font-mono text-xs">supabase login</code>{' '}
          remembers the profile, so subsequent commands need no flags.
        </p>
        <div className="flex flex-col gap-3">
          <CliCommandBlock
            command="supabase login --profile ~/.supabase/profiles/selfbase.toml"
            caption="Paste the token from Step 2 when prompted. Stores it in the OS keyring."
          />
          <CliCommandBlock
            command={`supabase link --project-ref ${exampleRef}`}
            caption={
              <>
                Replace <code className="font-mono">{exampleRef}</code> with the
                short ref from your <a href="/dashboard" className="underline">Projects</a> list.
              </>
            }
          />
          <CliCommandBlock
            command="supabase functions deploy hello"
            caption="Default eszip path — requires Docker locally for bundling."
          />
        </div>
        <Alert variant="default" className="mt-4">
          <AlertCircle className="size-4" />
          <AlertTitle>No Docker on this machine?</AlertTitle>
          <AlertDescription>
            Append <code className="mx-1 font-mono text-xs">--use-api</code> to
            <code className="mx-1 font-mono text-xs">functions deploy</code> and
            <code className="mx-1 font-mono text-xs">functions download</code>. Selfbase
            supports both paths.
          </AlertDescription>
        </Alert>
      </section>

      {/* Token-reveal dialog */}
      <Dialog
        open={tokenOpen}
        onOpenChange={(o) => {
          setTokenOpen(o);
          if (!o) setRevealedToken(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your CLI token</DialogTitle>
            <DialogDescription>
              This is the only time you will see this token. Copy it now and store
              it somewhere safe.
            </DialogDescription>
          </DialogHeader>
          {revealedToken && (
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all overflow-x-auto rounded-md border border-border bg-card px-3 py-2 font-mono text-xs">
                {revealedToken.token}
              </code>
              <CopyButton value={revealedToken.token} label="Copy token" />
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setTokenOpen(false)}>I have saved the token</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Shell>
  );
}
