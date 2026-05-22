import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Settings } from 'lucide-react';
import { instancesApi } from '@/lib/api';
import { Shell } from '@/components/Shell';
import { ProjectSubNav } from '@/components/ProjectSubNav';
import { Button } from '@/components/ui/button';

interface InstanceMeta {
  ref: string;
  name?: string;
  status: string;
  urls?: { kong: string | null; studio: string | null };
}

export function ProjectStudioPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const { data, isLoading } = useQuery<InstanceMeta>({
    queryKey: ['instances', ref],
    queryFn: () => instancesApi.get(ref) as Promise<InstanceMeta>,
    refetchInterval: (q) => {
      const s = (q.state.data as InstanceMeta | undefined)?.status;
      return s && s !== 'running' ? 5000 : false;
    },
  });

  const studioUrl = data?.urls?.kong ? `${data.urls.kong}/project/default` : null;
  const notReady = data && data.status !== 'running';

  return (
    <Shell bare>
      <ProjectSubNav active="studio" />
      <div className="h-[calc(100vh-96px)] bg-background">
        {isLoading && <Centered>Loading project…</Centered>}
        {!isLoading && notReady && (
          <NotReady ref_={ref} status={data!.status} />
        )}
        {!isLoading && !notReady && studioUrl && (
          <iframe
            key={studioUrl}
            src={studioUrl}
            title="Studio"
            className="block size-full border-0"
            // The iframe runs in the per-instance subdomain origin. We allow
            // clipboard for Studio's copy buttons; same-origin scripts run
            // normally (no sandbox attribute).
            allow="clipboard-read; clipboard-write"
          />
        )}
        {!isLoading && !notReady && !studioUrl && (
          <Centered>
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="text-foreground">Studio URL not configured yet</span>
              <span className="max-w-sm text-sm text-muted-foreground">
                Apex domain or per-instance routing isn&apos;t ready. Check the project&apos;s
                Health page and DNS/cert configuration.
              </span>
            </div>
          </Centered>
        )}
      </div>
    </Shell>
  );
}

function NotReady({ ref_, status }: { ref_: string; status: string }): React.ReactElement {
  return (
    <Centered>
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-full border border-border-soft bg-card">
          <Activity className="size-5 text-muted-foreground" strokeWidth={1.4} />
        </div>
        <div className="text-base font-medium text-foreground">
          Studio isn&apos;t reachable yet
        </div>
        <div className="text-sm text-muted-foreground">
          This project&apos;s status is{' '}
          <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-foreground">
            {status}
          </code>
          . Studio loads only once the instance is running.
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/dashboard/project/${ref_}/admin/health`}>
              <Activity className="size-3.5" />
              View health
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link to={`/dashboard/project/${ref_}/admin`}>
              <Settings className="size-3.5" />
              Go to admin
            </Link>
          </Button>
        </div>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="grid h-full place-items-center text-sm text-muted-foreground">{children}</div>
  );
}
