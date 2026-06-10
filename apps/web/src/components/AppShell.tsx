import { Link, NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Shared app shell (header + nav + theme) for the non-wizard web surfaces.
 * Feature 116 (US1 Foundation): introduced for /docs; reused by the future
 * /admin console. The /setup wizard keeps its own full-screen layout.
 */
const NAV = [
  { to: '/setup', label: 'Setup', end: false },
  { to: '/docs', label: 'Docs', end: false },
];

export function AppShell(): React.ReactElement {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-default">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/docs" className="font-medium tracking-tight">
            supastack
          </Link>
          <nav className="flex items-center gap-5 text-sm">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    'transition-colors',
                    isActive ? 'text-foreground' : 'text-foreground-light hover:text-foreground',
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
