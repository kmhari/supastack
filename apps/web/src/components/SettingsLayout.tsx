import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  KeyRound,
  Database,
  FileClock,
  Terminal,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SettingsTab {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match if pathname starts with any of these (handles aliases). */
  matchPrefixes: string[];
}

const TABS: SettingsTab[] = [
  {
    to: '/settings/org',
    label: 'Overview',
    icon: LayoutDashboard,
    matchPrefixes: ['/settings/org', '/settings/overview'],
  },
  { to: '/settings/members', label: 'Members', icon: Users, matchPrefixes: ['/settings/members'] },
  { to: '/settings/tokens', label: 'Tokens', icon: KeyRound, matchPrefixes: ['/settings/tokens'] },
  {
    to: '/settings/cli',
    label: 'CLI integration',
    icon: Terminal,
    matchPrefixes: ['/settings/cli'],
  },
  {
    to: '/settings/cli',
    label: 'CLI integration',
    icon: Terminal,
    matchPrefixes: ['/settings/cli'],
  },
  {
    to: '/settings/database',
    label: 'Database',
    icon: Database,
    matchPrefixes: ['/settings/database'],
  },
  { to: '/settings/audit', label: 'Audit', icon: FileClock, matchPrefixes: ['/settings/audit'] },
];

/**
 * Settings layout — sidebar pinned to the far left edge of the viewport,
 * content area takes the remaining width with a fixed max-width and is
 * centered inside that area.
 *
 * Designed to be used with `<Shell bare>` so this component owns the
 * full-bleed left rail.
 *
 * Mobile (< md): sidebar collapses to a horizontal scroller above content.
 */
export function SettingsLayout({
  children,
  active,
}: {
  children: React.ReactNode;
  /** Active route prefix override (falls back to NavLink URL match if omitted). */
  active?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col md:flex-row md:min-h-[calc(100vh-3rem)]">
      {/* Sidebar — pinned to viewport left edge, full-height column */}
      <aside className="shrink-0 md:w-60 md:border-r md:border-border-soft md:sticky md:top-12 md:self-start md:h-[calc(100vh-3rem)] md:overflow-y-auto">
        <nav
          aria-label="Settings sections"
          className="flex md:flex-col gap-0.5 overflow-x-auto md:overflow-visible px-4 sm:px-6 py-3 md:py-6 border-b md:border-b-0 border-border-soft"
        >
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = active
              ? active === t.to || t.matchPrefixes.some((p) => active.startsWith(p))
              : undefined;
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={false}
                className={({ isActive: rrActive }) => {
                  const on = isActive ?? rrActive;
                  return cn(
                    'inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium no-underline transition-colors',
                    on
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  );
                }}
              >
                <Icon className="size-4" />
                {t.label}
              </NavLink>
            );
          })}
        </nav>
      </aside>

      {/* Content area — flex-1, with content inside centered + max-width */}
      <main className="flex-1 min-w-0 px-4 sm:px-8 pt-6 pb-12 sm:pt-10 sm:pb-20">
        <div className="mx-auto w-full max-w-[800px]">{children}</div>
      </main>
    </div>
  );
}
