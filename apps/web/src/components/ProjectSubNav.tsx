import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight } from 'lucide-react';
import { instancesApi } from '@/lib/api';
import { cn } from '@/lib/utils';

interface InstanceMeta {
  ref: string;
  name?: string;
  urls?: { kong: string | null; studio: string | null };
}

/**
 * Slim project-scoped header strip rendered below the global Shell nav.
 * Holds: breadcrumb (Projects / <name>), Studio/Admin tabs, and an
 * "open Studio in a new tab" escape hatch.
 *
 * Pages that use this strip should size their body with
 * h-[calc(100vh-96px)] (48px Shell nav + 48px sub-nav).
 */
export function ProjectSubNav({
  active,
}: {
  active: 'studio' | 'admin';
}): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const { data } = useQuery<InstanceMeta>({
    queryKey: ['instances', ref, 'subnav'],
    queryFn: () => instancesApi.get(ref) as Promise<InstanceMeta>,
  });
  const studioUrl = data?.urls?.kong ? `${data.urls.kong}/project/default` : null;

  return (
    <div className="flex h-12 items-center justify-between border-b border-border-soft bg-background px-6">
      <div className="flex items-center gap-2.5 text-sm">
        <Link
          to="/dashboard"
          className="text-muted-foreground transition-colors hover:text-foreground no-underline"
        >
          Projects
        </Link>
        <span className="text-muted-foreground/50">/</span>
        <span className="font-medium text-foreground">{data?.name ?? ref}</span>
      </div>
      <div className="flex items-center gap-1">
        <SubTab to={`/dashboard/project/${ref}`} label="Studio" active={active === 'studio'} />
        <SubTab
          to={`/dashboard/project/${ref}/admin`}
          label="Admin"
          active={active === 'admin'}
        />
        {studioUrl && (
          <a
            href={studioUrl}
            target="_blank"
            rel="noreferrer"
            title="Open Studio in a new tab"
            aria-label="Open Studio in a new tab"
            className="ml-2 inline-flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-secondary hover:text-foreground no-underline"
          >
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function SubTab({
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
        'rounded px-3 py-1.5 text-sm no-underline transition-colors',
        active
          ? 'bg-secondary text-foreground font-medium'
          : 'text-foreground-light hover:bg-secondary/50 hover:text-foreground',
      )}
    >
      {label}
    </Link>
  );
}
