import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ProjectShell } from '@/components/ProjectShell';
import { authConfigApi, type AuthConfigResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { SiteUrlForm } from './auth-url-config/SiteUrlForm';
import { RedirectUrlsList } from './auth-url-config/RedirectUrlsList';
import { AddRedirectUrlsDialog } from './auth-url-config/AddRedirectUrlsDialog';
import { parseAllowList, serializeAllowList } from './auth-url-config/redirect-url-helpers';
import { useRestartToast } from './auth-providers/use-restart-toast';

/**
 * Auth → URL Configuration page.
 *
 * Spec: specs/022-url-configuration/spec.md (US1, US2, US3, US4)
 * Plan: specs/022-url-configuration/plan.md
 * Tasks: T002, T010, T015
 */
export function ProjectAuthUrlConfigPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data: authConfig } = useQuery<AuthConfigResponse>({
    queryKey: ['auth-config', ref],
    queryFn: () => authConfigApi.get(ref),
    enabled: Boolean(ref),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const save = useRestartToast(ref, () => setDialogOpen(false));

  const urls = useMemo(
    () => parseAllowList((authConfig?.uri_allow_list as string | null | undefined) ?? ''),
    [authConfig?.uri_allow_list],
  );

  function handleAddBatch(batch: string[]): void {
    save({ uri_allow_list: serializeAllowList([...urls, ...batch]) });
  }

  function handleDelete(target: string): void {
    save({ uri_allow_list: serializeAllowList(urls.filter((u) => u !== target)) });
  }

  return (
    <ProjectShell
      title="URL Configuration"
      subtitle="Configure site URL and redirect URLs for authentication"
    >
      <div className="flex flex-col gap-8">
        {authConfig ? (
          <>
            <SiteUrlForm
              initialValue={(authConfig.site_url as string | null) ?? ''}
              isAdmin={isAdmin}
              onSave={(next) => save({ site_url: next })}
            />
            <RedirectUrlsList
              urls={urls}
              isAdmin={isAdmin}
              onDelete={handleDelete}
              onAddClick={() => setDialogOpen(true)}
            />
          </>
        ) : null}
      </div>

      <AddRedirectUrlsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        existingUrls={urls}
        onSave={handleAddBatch}
      />
    </ProjectShell>
  );
}

export default ProjectAuthUrlConfigPage;
