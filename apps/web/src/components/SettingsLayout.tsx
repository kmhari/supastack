import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  KeyRound,
  Database,
  FileClock,
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
  { to: '/settings/org', label: 'Overview', icon: LayoutDashboard, matchPrefixes: ['/settings/org', '/settings/overview'] },
  { to: '/settings/members', label: 'Members', icon: Users, matchPrefixes: ['/settings/members'] },
  { to: '/settings/tokens', label: 'Tokens', icon: KeyRound, matchPrefixes: ['/settings/tokens'] },
  { to: '/settings/database', label: 'Database', icon: Database, matchPrefixes: ['/settings/database'] },
  { to: '/settings/audit', label: 'Audit', icon: FileClock, matchPrefixes: ['/settings/audit'] },
];

/**
 * Two-column layout for Settings pages: vertical tab sidebar on the left,
 * page content on the right. Mobile collapses to a horizontal scroller of
 * tabs above the content.
 */
export function SettingsLayout({
  children,
  active,
}: {
  children: React.ReactNode;
  /** Active route prefix, e.g. '/settings/database'. Falls back to URL match if omitted. */
  active?: string;
}): React.ReactElement {
  return (
    <div className="grid gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <aside className="md:sticky md:top-4 md:self-start">
        {/* Desktop: vertical list. Mobile: horizontal scroller. */}
        <nav
          aria-label="Settings sections"
          className="flex md:flex-col gap-0.5 overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0 border-b md:border-0 border-border-soft"
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
      <div>{children}</div>
    </div>
  );
}
