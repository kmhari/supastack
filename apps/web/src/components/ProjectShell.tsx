import { Link, useLocation, useParams } from 'react-router-dom';
import { Shell } from '@/components/Shell';
import { ProjectSubNav } from '@/components/ProjectSubNav';
import { cn } from '@/lib/utils';

/**
 * Wrapper for every /dashboard/project/:ref/admin/* page. Lays out:
 *   <Shell bare> top nav (48px)
 *   <ProjectSubNav active="admin"> project breadcrumb + Studio/Admin tabs (48px)
 *   sticky left sidebar + right content column
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

  const base = `/dashboard/project/${ref}/admin`;
  const groups: { heading: string; items: { to: string; label: string }[] }[] = [
    {
      heading: 'Configuration',
      items: [
        { to: base, label: 'General' },
        { to: `${base}/api-keys`, label: 'API Keys' },
        { to: `${base}/jwt-keys`, label: 'JWT Keys' },
        { to: `${base}/backups`, label: 'Backups' },
      ],
    },
    {
      heading: 'Diagnostics',
      items: [{ to: `${base}/health`, label: 'Health' }],
    },
  ];

  return (
    <Shell bare>
      <ProjectSubNav active="admin" />
      <div className="flex min-h-[calc(100vh-96px)] items-stretch">
        <aside className="sticky top-24 h-[calc(100vh-96px)] w-60 shrink-0 overflow-y-auto border-r border-border-soft px-4 py-8">
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
