import { useSnippets } from '@/lib/use-snippets';
import { CodeBlock } from '@/components/docs/CodeBlock';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** /docs/cli — connect the upstream supabase CLI via the supastack wrapper. Feature 116 (US1). */
export function DocsCli(): React.ReactElement {
  const { snippets: s } = useSnippets();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect the Supabase CLI</h1>
        <p className="mt-2 text-sm text-foreground-light">
          The unmodified upstream <code>supabase</code> CLI works against your self-hosted projects.
          The supastack wrapper auto-injects your token and routes commands to your instance.
        </p>
      </div>

      {s.isPlaceholder && (
        <Alert>
          <AlertDescription>
            Finish setup to personalize these commands with your domain. Until then they show{' '}
            <code>&lt;your-apex&gt;</code>.
          </AlertDescription>
        </Alert>
      )}

      <section>
        <h2 className="text-lg font-medium">Quickstart</h2>

        <p className="mt-3 text-sm text-foreground-light">1. Install the CLI:</p>
        <CodeBlock code={'brew install supabase/tap/supabase\n# or: npm i -g supabase'} />

        <p className="mt-3 text-sm text-foreground-light">
          2. Add the supastack wrapper to your shell (append to <code>~/.zshrc</code>, then{' '}
          <code>source ~/.zshrc</code>):
        </p>
        <CodeBlock code={s.wrapper} />

        <p className="mt-3 text-sm text-foreground-light">
          3. Mint a Personal Access Token at{' '}
          <a
            href={s.tokensUrl}
            className="text-brand-600 underline"
            target="_blank"
            rel="noreferrer"
          >
            {s.tokensUrl}
          </a>{' '}
          (Account → Access Tokens). It looks like <code>sbp_…</code>.
        </p>

        <p className="mt-3 text-sm text-foreground-light">
          4. Create a <code>.supastack</code> file at your repo root (replace the token with yours):
        </p>
        <CodeBlock code={s.supastackFile} />

        <p className="mt-3 text-sm text-foreground-light">
          That&apos;s it — any <code>supabase</code> command run inside that repo now routes to your
          project:
        </p>
        <CodeBlock code={'supabase projects list\nsupabase db push'} />
      </section>

      <details className="rounded-md border border-default bg-surface-200 p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Manual setup (without the wrapper)
        </summary>
        <div className="mt-3 space-y-3 text-sm text-foreground-light">
          <p>Point the CLI at your instance with an explicit profile and token:</p>
          <CodeBlock
            code={`export SUPABASE_ACCESS_TOKEN=sbp_your_pat_here\nsupabase projects list --profile ${s.apex}`}
          />
          <p>
            On first use the wrapper auto-generates <code>~/.config/supastack/{s.apex}.toml</code>{' '}
            (the CLI profile pointing at <code>api.{s.apex}</code>). You can write that file
            yourself and pass <code>--profile</code> on every command instead of using the wrapper.
          </p>
        </div>
      </details>
    </div>
  );
}
