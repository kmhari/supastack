import { Link } from 'react-router-dom';
import { Terminal, Plug } from 'lucide-react';

/** /docs landing — links to the CLI + MCP guides. Feature 116 (US1). */
const CARDS = [
  {
    to: '/docs/cli',
    icon: Terminal,
    title: 'Supabase CLI',
    desc: 'Run the upstream `supabase` CLI against your self-hosted projects — connect-and-go with the supastack wrapper.',
  },
  {
    to: '/docs/mcp',
    icon: Plug,
    title: 'MCP (AI tools)',
    desc: 'Connect Claude Code, Cursor, Windsurf, or Claude Desktop to the hosted multi-project MCP server.',
  },
];

export function DocsIndex(): React.ReactElement {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Connect to your supastack</h1>
      <p className="mt-2 text-sm text-foreground-light">
        Self-hosted Supabase, the upstream tooling, and AI clients — wired to your projects. Pick a
        guide; the commands are filled in with your platform&apos;s address.
      </p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {CARDS.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="group rounded-lg border border-default bg-surface-200 p-5 transition-colors hover:border-strong"
          >
            <c.icon className="size-5 text-foreground-light" />
            <div className="mt-3 flex items-center gap-1 font-medium">
              {c.title}
              <span className="text-foreground-lighter transition-transform group-hover:translate-x-0.5">
                →
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground-light">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
