import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Link } from 'react-router-dom';
import { Terminal, Check, Copy, ExternalLink } from 'lucide-react';
import { apexApi } from '@/lib/api';
import { getWrapperSnippet } from '@/lib/cli-wrapper';
import { useAuth } from '@/lib/auth-context';
import { Shell } from '@/components/Shell';
import { SettingsLayout } from '@/components/SettingsLayout';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * /settings/cli — installation + setup instructions for the supabase CLI
 * against this supastack deployment. Includes a copy-ready profile TOML
 * pre-filled with the apex domain, plus the `~/.supabase/profile` setup
 * needed so plain `supabase login` works without a `--profile` flag each
 * invocation.
 *
 * Spec follow-up to feature 011.
 */
export function SettingsCliPage(): React.ReactElement {
  const { user } = useAuth();
  const { data: apexStatus } = useQuery({
    queryKey: ['apex'],
    queryFn: () => apexApi.status(),
    enabled: user?.role === 'admin' || user?.role === 'member',
  });

  if (user && user.role !== 'admin' && user.role !== 'member') {
    return <Navigate to="/dashboard" replace />;
  }

  const apex = apexStatus?.apex ?? '<your-apex-domain>';
  const tomlContent = `name          = "supastack"
api_url       = "https://api.${apex}"
dashboard_url = "https://${apex}/dashboard"
project_host  = "${apex}"`;

  const writeTomlCmd = `mkdir -p ~/.config && cat > ~/.config/supastack.toml <<'EOF'
${tomlContent}
EOF`;

  const setDefaultCmd = `printf '%s' "$HOME/.config/supastack.toml" > ~/.supabase/profile`;

  const loginCmd = `supabase login`;

  const verifyCmd = `supabase projects list`;

  const supastackFileCmd = `cat > .supastack << 'EOF'\ntoken=<your-api-token>\ndomain=${apex}\nEOF`;

  const wrapperSnippet = getWrapperSnippet(apex);

  return (
    <Shell bare>
      <SettingsLayout>
        <PageHeader
          title="CLI integration"
          subtitle="Connect the upstream supabase CLI to this supastack deployment."
        />

        <div className="mt-8 flex flex-col gap-10">
          <Section
            number={1}
            title="Install the supabase CLI"
            body={
              <>
                If you haven't yet, install it via your package manager — see{' '}
                <a
                  href="https://supabase.com/docs/guides/cli/getting-started"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 underline"
                >
                  official install docs
                  <ExternalLink className="size-3" />
                </a>
                . On macOS: <Code inline>brew install supabase/tap/supabase</Code>.
              </>
            }
          />

          <Section
            number={2}
            title="Save the supastack profile"
            body={
              <>
                The supabase CLI is configured per-deployment via a small TOML profile that tells it
                where this supastack install lives. Run this once on each machine you'll use the CLI
                from:
              </>
            }
            code={writeTomlCmd}
          />

          <Section
            number={3}
            title="Make it the global default profile"
            body={
              <>
                So every <Code inline>supabase</Code> command uses this deployment automatically (no{' '}
                <Code inline>--profile</Code> flag needed). This is the simplest path if you only
                work against one supastack deployment; see Section 6 for the per-project alternative
                if you juggle Cloud + supastack or multiple supastack deployments.
              </>
            }
            code={setDefaultCmd}
          />

          <Section
            number={4}
            title="Log in"
            body={
              <>
                Run <Code inline>supabase login</Code> — the CLI will open your browser, you'll see
                a short verification code, paste it back into the terminal, and you're done. The CLI
                writes the access token to <Code inline>~/.supabase/access-token</Code>; tokens
                minted this way show up in{' '}
                <Link to="/settings/tokens" className="underline">
                  Access Tokens
                </Link>{' '}
                with a small "cli" badge so you can revoke them later.
              </>
            }
            code={loginCmd}
          />

          <Section
            number={5}
            title="Verify"
            body={<>Smoke-test that the CLI is now talking to this supastack deployment:</>}
            code={verifyCmd}
            note="Expected output: a table listing the projects on this deployment (not Supabase Cloud's)."
          />

          <Section
            number={6}
            title="Optional: per-project auto-routing"
            body={
              <>
                If you work across multiple deployments (Cloud + supastack, or several supastack
                installs), the global default from Section 3 is awkward. Instead, create a{' '}
                <Code inline>.supastack</Code> file at your project&apos;s git root with your token
                and domain. Then paste the zsh wrapper below into <Code inline>~/.zshrc</Code> — it
                walks up to the git root, reads <Code inline>token=</Code> and{' '}
                <Code inline>domain=</Code> from <Code inline>.supastack</Code>, auto-generates the
                per-domain profile under <Code inline>~/.config/supastack/&lt;domain&gt;.toml</Code>,
                and passes <Code inline>--profile</Code> to the CLI automatically. The{' '}
                <Code inline>domain=</Code> line alone is safe to commit — add{' '}
                <Code inline>.supastack</Code> to your <Code inline>.gitignore</Code> if the file
                contains a token.
              </>
            }
            code={supastackFileCmd}
          />

          <Section
            number={7}
            title="The zsh wrapper"
            body={
              <>
                Paste this into your <Code inline>~/.zshrc</Code> (replacing any existing{' '}
                <Code inline>supabase()</Code> function); reload with{' '}
                <Code inline>source ~/.zshrc</Code>.
              </>
            }
            code={wrapperSnippet}
            note="On first supastack invocation, you'll see '✓ Generated supastack profile (~/.config/supastack/<apex>.toml)' once. Every subsequent call prints '✓ Using supastack profile (...)' for visibility. After any successful 'supabase login', the wrapper checks for ~/.supabase/profile (which the upstream CLI writes whenever --profile is passed) and interactively offers to remove it — keeping plain 'supabase login' free for Cloud or other deployments."
          />

          <Card className="bg-secondary/20 p-5">
            <h3 className="m-0 mb-2 text-sm font-medium">Switching back to Supabase Cloud</h3>
            <p className="m-0 text-sm text-muted-foreground">
              Either pass <Code inline>--profile supabase</Code> on a one-off command, wipe the
              default with <Code inline>rm ~/.supabase/profile</Code> and re-run{' '}
              <Code inline>supabase login</Code> (with no <Code inline>--profile</Code>), or — if
              you're using the Section-6 wrapper — just <Code inline>cd</Code> out of any directory
              containing a <Code inline>.supastack</Code> file.
            </p>
          </Card>
        </div>
      </SettingsLayout>
    </Shell>
  );
}

function Section({
  number,
  title,
  body,
  code,
  note,
}: {
  number: number;
  title: string;
  body: React.ReactNode;
  code?: string;
  note?: string;
}): React.ReactElement {
  return (
    <section>
      <h2 className="m-0 mb-2 flex items-center gap-2 text-base font-medium">
        <span className="grid size-6 place-items-center rounded-full bg-secondary text-xs font-medium">
          {number}
        </span>
        {title}
      </h2>
      <div className="ml-8 flex flex-col gap-2">
        <p className="m-0 text-sm text-muted-foreground">{body}</p>
        {code && <CodeBlock content={code} />}
        {note && <p className="m-0 text-xs text-muted-foreground">{note}</p>}
      </div>
    </section>
  );
}

function CodeBlock({ content }: { content: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="m-0 overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 pr-12 font-mono text-xs leading-relaxed text-foreground">
        <code>{content}</code>
      </pre>
      <Button
        htmlType="button"
        type="text"
        size="small"
        className="absolute right-1.5 top-1.5"
        onClick={() => {
          void navigator.clipboard.writeText(content).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        aria-label="Copy"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

function Code({
  children,
  inline,
}: {
  children: React.ReactNode;
  inline?: boolean;
}): React.ReactElement {
  return inline ? (
    <code className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[12px]">{children}</code>
  ) : (
    <code>{children}</code>
  );
}

// Use the icon in the page header so the sidebar icon + page icon match.
void Terminal;
