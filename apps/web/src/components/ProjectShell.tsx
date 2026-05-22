import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FileLock2, KeyRound, Save, Settings } from 'lucide-react';
import { instancesApi } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { StatusPill } from '@/components/StatusPill';
import { cn } from '@/lib/utils';

interface ProjectMeta {
  ref: string;
  name: string;
  status: string;
}

/**
 * Wrapper for every /p/:ref/* page. Renders the breadcrumb header,
 * project name + status, and the left settings sidebar that mirrors
 * the Supabase project Settings layout (General, API Keys, JWT Keys,
 * Backups). Pages render their own content inside the right column.
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

  const { data: meta } = useQuery<ProjectMeta>({
    queryKey: ['instances', ref, 'meta'],
    queryFn: () => instancesApi.get(ref) as Promise<ProjectMeta>,
    refetchInterval: (q) => {
      const status = (q.state.data as ProjectMeta | undefined)?.status;
      return status && ['provisioning', 'deleting'].includes(status) ? 3_000 : 30_000;
    },
  });

  const tabs: { to: string; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { to: `/p/${ref}`, label: 'General', icon: Settings },
    { to: `/p/${ref}/api-keys`, label: 'API Keys', icon: KeyRound },
    { to: `/p/${ref}/jwt-keys`, label: 'JWT Keys', icon: FileLock2 },
    { to: `/p/${ref}/backups`, label: 'Backups', icon: Save },
  ];

  return (
    <Shell wide>
      <div className="mb-4 flex items-center justify-between text-sm">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-muted-foreground no-underline hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All projects
        </Link>
        {meta && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-foreground">{meta.name}</span>
            <StatusPill status={meta.status} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-[220px_1fr] gap-10">
        <aside className="border-r border-border-soft pr-6">
          <div className="mb-2 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Configuration
          </div>
          <nav className="flex flex-col gap-0.5">
            {tabs.map((t) => {
              const isActive = pathname === t.to;
              const Icon = t.icon;
              return (
                <Link
                  key={t.to}
                  to={t.to}
                  className={cn(
                    'inline-flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm no-underline transition-colors',
                    isActive
                      ? 'bg-secondary text-foreground'
                      : 'text-foreground-light hover:bg-secondary/50 hover:text-foreground',
                  )}
                >
                  <Icon className="size-3.5 text-muted-foreground" />
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0">
          <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-7 flex flex-col gap-5">{children}</div>
        </div>
      </div>
    </Shell>
  );
}
