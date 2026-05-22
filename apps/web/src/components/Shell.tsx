import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function Shell({
  children,
  wide,
}: {
  children: React.ReactNode;
  wide?: boolean;
}): React.ReactElement {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  const isProjectsActive =
    pathname === '/' || (pathname.startsWith('/p/') && !pathname.startsWith('/settings/'));
  const isSettingsActive = (prefix: string): boolean => pathname.startsWith(prefix);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <nav className="flex h-12 items-center justify-between border-b border-border-soft px-8">
        <div className="flex items-center gap-7">
          <Link to="/" className="flex items-center gap-2.5 text-foreground no-underline">
            <span aria-hidden className="inline-block size-[22px] rounded bg-success" />
            <strong className="text-sm font-medium">Selfbase</strong>
          </Link>
          <div className="flex items-center gap-1">
            <NavTab to="/" label="Projects" active={isProjectsActive} />
            <NavTab to="/settings/org" label="Settings" active={isSettingsActive('/settings/org')} />
            <NavTab
              to="/settings/members"
              label="Members"
              active={isSettingsActive('/settings/members')}
            />
            <NavTab
              to="/settings/tokens"
              label="Tokens"
              active={isSettingsActive('/settings/tokens')}
            />
            <NavTab
              to="/settings/audit"
              label="Audit"
              active={isSettingsActive('/settings/audit')}
            />
          </div>
        </div>
        <div className="flex items-center gap-3.5 text-sm">
          <span className="text-muted-foreground">{user?.email ?? ''}</span>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </nav>
      <main className={cn('mx-auto px-8 pt-10 pb-20', wide ? 'max-w-[1280px]' : 'max-w-[960px]')}>
        {children}
      </main>
    </div>
  );
}

function NavTab({
  to,
  label,
  active,
}: {
  to: string;
  label: string;
  active: boolean;
}): React.ReactElement {
  return (
    <Link
      to={to}
      className={cn(
        'rounded px-2.5 py-1.5 text-sm no-underline transition-colors',
        active
          ? 'bg-secondary text-foreground font-medium'
          : 'text-foreground-light hover:text-foreground hover:bg-secondary/50',
      )}
    >
      {label}
    </Link>
  );
}
