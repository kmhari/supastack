import { useState } from 'react';
import { useSnippets } from '@/lib/use-snippets';
import { CodeBlock } from '@/components/docs/CodeBlock';
import { CopyButton } from '@/components/CopyButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

/** /docs/mcp — connect an AI tool to the hosted MCP server. Feature 116 (US1). */
export function DocsMcp(): React.ReactElement {
  const { snippets: s } = useSnippets();
  const [tab, setTab] = useState(0);
  const cfg = s.mcpConfigs[tab];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect an AI tool (MCP)</h1>
        <p className="mt-2 text-sm text-foreground-light">
          supastack hosts a multi-project MCP server. Paste one URL into your editor, authorize once
          in the browser, and every tool call routes to the right project automatically.
        </p>
      </div>

      {s.isPlaceholder && (
        <Alert>
          <AlertDescription>
            Finish setup to personalize this with your domain. Until then it shows{' '}
            <code>&lt;your-apex&gt;</code>.
          </AlertDescription>
        </Alert>
      )}

      <section>
        <h2 className="text-lg font-medium">Your MCP endpoint</h2>
        <div className="mt-2 flex items-center gap-2">
          <code className="rounded bg-surface-200 px-2 py-1 text-sm">{s.mcpUrl}</code>
          <CopyButton value={s.mcpUrl} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">Add it to your editor</h2>
        <div className="mt-2 flex flex-wrap gap-1">
          {s.mcpConfigs.map((c, i) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setTab(i)}
              className={cn(
                'rounded px-3 py-1 text-sm transition-colors',
                i === tab
                  ? 'bg-surface-300 text-foreground'
                  : 'text-foreground-light hover:text-foreground',
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-sm text-foreground-light">
          Add to <code>{cfg.file}</code>:
        </p>
        <CodeBlock code={cfg.json} />
      </section>

      <section>
        <h2 className="text-lg font-medium">How it works</h2>
        <p className="mt-2 text-sm text-foreground-light">
          On the first MCP call your browser opens to the supastack authorize page. If you&apos;re
          already signed into the dashboard, click <strong>Authorize</strong> and the tab closes
          automatically — no token management needed.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-medium">Revoke access</h2>
        <p className="mt-2 text-sm text-foreground-light">
          Manage or revoke connected clients from your{' '}
          <a href={s.dashboardUrl} className="text-brand-600 underline" target="_blank" rel="noreferrer">
            dashboard
          </a>{' '}
          (Organization → OAuth Apps / MCP clients). Revocation takes effect within a few seconds.
        </p>
      </section>
    </div>
  );
}
