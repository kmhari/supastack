import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { wildcardCertApi } from '@/lib/api';

function RenewalBanner(): React.ReactElement | null {
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ notAfter: string } | null>(null);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem('cert-renewal-dismissed') === '1',
  );

  useEffect(() => {
    if (dismissed) return;
    wildcardCertApi
      .status()
      .then((res) => {
        if (res.cert?.renewalDue && res.cert.notAfter) {
          setInfo({ notAfter: res.cert.notAfter });
        }
      })
      .catch(() => undefined);
  }, [dismissed]);

  if (dismissed || !info) return null;

  const expires = new Date(info.notAfter).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="flex items-center justify-between border-b border-amber-600/30 bg-amber-950/40 px-8 py-2 text-sm text-amber-300">
      <span>
        Your wildcard certificate expires on <strong>{expires}</strong>. Renew it to avoid
        disruption.
      </span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="font-medium text-amber-200 hover:text-white underline bg-transparent p-0"
          onClick={() => navigate('/settings/tls')}
        >
          Renew now →
        </button>
        <button
          type="button"
          className="text-amber-400 hover:text-amber-200 bg-transparent p-0"
          onClick={() => {
            sessionStorage.setItem('cert-renewal-dismissed', '1');
            setDismissed(true);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export function Shell({
  children,
  wide,
  bare,
}: {
  children: React.ReactNode;
  /** Set to true on the Projects dashboard (max-width 1280); other pages use the narrower 960 column. */
  wide?: boolean;
  /** Skip the centered max-width container — caller wants to own the layout
   *  (e.g. ProjectShell renders a full-bleed sidebar + content split). */
  bare?: boolean;
}): React.ReactElement {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();

  const isProjectsActive =
    pathname === '/' ||
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname.startsWith('/p/'); // legacy URLs before redirect kicks in
  const isSettingsActive = (prefix: string): boolean => pathname.startsWith(prefix);

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <RenewalBanner />
      <nav className="flex h-12 items-center justify-between border-b border-border-soft px-4 sm:px-8">
        <div className="flex items-center gap-7">
          <Link to="/dashboard" className="flex items-center gap-2.5 text-foreground no-underline">
            <span aria-hidden className="inline-block size-[22px] rounded bg-success" />
            <strong className="text-sm font-medium">Supastack</strong>
          </Link>
          <div className="flex items-center gap-1">
            <NavTab to="/dashboard" label="Projects" active={isProjectsActive} />
            {/* Settings groups (Overview, Members, Tokens, Database, Audit)
                live on a sidebar inside the settings pages themselves. */}
            <NavTab to="/settings/org" label="Settings" active={isSettingsActive('/settings')} />
          </div>
        </div>
        <div className="flex items-center gap-3.5 text-sm">
          <span className="text-muted-foreground">{user?.email ?? ''}</span>
          <Button variant="outline" size="sm" onClick={() => void logout()}>
            Sign out
          </Button>
        </div>
      </nav>
      {bare ? (
        <main>{children}</main>
      ) : (
        <main
          className={cn(
            'mx-auto px-4 pt-6 pb-12 sm:px-8 sm:pt-10 sm:pb-20',
            wide ? 'max-w-[1280px]' : 'max-w-[960px]',
          )}
        >
          {children}
        </main>
      )}
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
