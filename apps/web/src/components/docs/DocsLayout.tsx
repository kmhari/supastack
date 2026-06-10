import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

/** Sidebar + content layout for /docs/*. Nested inside AppShell. Feature 116 (US1). */
const ITEMS = [
  { to: '/docs', label: 'Overview', end: true },
  { to: '/docs/cli', label: 'CLI', end: false },
  { to: '/docs/mcp', label: 'MCP', end: false },
];

export function DocsLayout(): React.ReactElement {
  return (
    <div className="flex gap-10">
      <aside className="w-40 shrink-0">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-lighter">
          Docs
        </div>
        <nav className="flex flex-col gap-0.5 text-sm">
          {ITEMS.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.end}
              className={({ isActive }) =>
                cn(
                  'rounded px-2 py-1 transition-colors',
                  isActive
                    ? 'bg-surface-200 text-foreground'
                    : 'text-foreground-light hover:text-foreground',
                )
              }
            >
              {i.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 max-w-3xl flex-1">
        <Outlet />
      </div>
    </div>
  );
}
