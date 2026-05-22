import { Link, useLocation, useParams } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { cn } from '@/lib/utils';

/**
 * Wrapper for every /p/:ref/* page. Mirrors supabase.com's project
 * Settings layout — left sidebar grouped under a "Settings" heading,
 * right column with the page title + content. The global top nav
 * (in <Shell>) already provides the back-to-Projects link, so this
 * shell doesn't repeat it.
 */
export function ProjectShell({
  children,
  title,
  subtitle,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const { pathname } = useLocation();

  const groups: { heading: string; items: { to: string; label: string }[] }[] = [
    {
      heading: 'Configuration',
      items: [
        { to: `/p/${ref}`, label: 'General' },
        { to: `/p/${ref}/api-keys`, label: 'API Keys' },
        { to: `/p/${ref}/jwt-keys`, label: 'JWT Keys' },
        { to: `/p/${ref}/backups`, label: 'Backups' },
      ],
    },
    {
      heading: 'Diagnostics',
      items: [{ to: `/p/${ref}/health`, label: 'Health' }],
    },
  ];

  return (
    <Shell bare>
      <div className="flex min-h-[calc(100vh-48px)] items-stretch">
        <aside className="sticky top-12 h-[calc(100vh-48px)] w-60 shrink-0 overflow-y-auto border-r border-border-soft px-4 py-8">
          <h2 className="m-0 mb-4 px-2 text-base font-medium text-foreground">Settings</h2>
          {groups.map((g) => (
            <div key={g.heading} className="mb-6">
              <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {g.heading}
              </div>
              <nav className="flex flex-col gap-0.5">
                {g.items.map((t) => {
                  const isActive = pathname === t.to;
                  return (
                    <Link
                      key={t.to}
                      to={t.to}
                      className={cn(
                        'rounded-md px-2.5 py-1.5 text-sm no-underline transition-colors',
                        isActive
                          ? 'bg-secondary text-foreground'
                          : 'text-foreground-light hover:bg-secondary/50 hover:text-foreground',
                      )}
                    >
                      {t.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
          ))}
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mx-auto max-w-[920px] px-10 py-10">
            <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">{title}</h1>
            {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
            <div className="mt-7 flex flex-col gap-8">{children}</div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
