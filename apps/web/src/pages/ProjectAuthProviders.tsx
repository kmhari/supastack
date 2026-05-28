import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ProjectShell } from '@/components/ProjectShell';
import { Card } from '@/components/ui/card';
import { Sheet } from '@/components/ui/sheet';
import { authConfigApi, apexApi, type AuthConfigResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
  PROVIDER_REGISTRY,
  findProviderByDisplayName,
  type ActiveOAuthProvider,
  type ProviderDef,
} from './auth-providers/provider-registry';
import { ProviderRow, EmailPhoneToggleRow, ComingSoonRow } from './auth-providers/ProviderRow';
import { GoogleForm } from './auth-providers/GoogleForm';
import { CommonFour } from './auth-providers/CommonFour';
import { PlusUrl } from './auth-providers/PlusUrl';
import { WorkOsShape } from './auth-providers/WorkOsShape';
import { AppleForm } from './auth-providers/AppleForm';
import { OidcForm } from './auth-providers/OidcForm';
import { GlobalTogglesForm } from './auth-providers/GlobalTogglesForm';
import { useRestartToast } from './auth-providers/use-restart-toast';

/**
 * Auth → Providers page.
 *
 * Spec: specs/020-auth-providers-dashboard/spec.md US1, US2, US5
 * Plan: specs/020-auth-providers-dashboard/plan.md §C3
 * Tasks: T017, T018 (US1) + T045 (US2 dispatch) + T057 (US5 placeholders)
 */
export function ProjectAuthProvidersPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [searchParams, setSearchParams] = useSearchParams();
  const providerParam = searchParams.get('provider');

  const [activeProvider, setActiveProvider] = useState<ActiveOAuthProvider | null>(null);

  function openProvider(p: ActiveOAuthProvider): void {
    setActiveProvider(p);
    const next = new URLSearchParams(searchParams);
    next.set('provider', p.displayName);
    setSearchParams(next, { replace: false });
  }

  function closeProvider(): void {
    setActiveProvider(null);
    if (searchParams.has('provider')) {
      const next = new URLSearchParams(searchParams);
      next.delete('provider');
      setSearchParams(next, { replace: true });
    }
  }

  const { data: authConfig } = useQuery<AuthConfigResponse>({
    queryKey: ['auth-config', ref],
    queryFn: () => authConfigApi.get(ref),
    enabled: Boolean(ref),
  });

  const { data: apexStatus } = useQuery({
    queryKey: ['apex'],
    queryFn: () => apexApi.status(),
  });
  const apex = apexStatus?.apex ?? null;

  const save = useRestartToast(ref, () => closeProvider());

  // Deep-link sync: keep drawer in sync with ?provider=<DisplayName>.
  // Opening a drawer pushes the param; closing strips it. External changes
  // (back/forward, paste-URL) drive open/close here.
  useEffect(() => {
    if (!providerParam) {
      if (activeProvider) setActiveProvider(null);
      return;
    }
    if (activeProvider?.displayName === providerParam) return;
    const p = findProviderByDisplayName(providerParam);
    if (p && p.kind === 'oauth') {
      setActiveProvider(p);
    }
  }, [providerParam]);

  const rows = useMemo(() => splitRegistry(PROVIDER_REGISTRY), []);

  return (
    <ProjectShell
      title="Auth Providers"
      subtitle="Configure authentication providers and login methods for your users"
    >
      <div className="flex flex-col gap-6">
        {authConfig ? (
          <GlobalTogglesForm authConfig={authConfig} isAdmin={isAdmin} onSave={save} />
        ) : null}

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="m-0 text-xl font-normal tracking-tight text-foreground">
              Auth Providers
            </h2>
            <p className="m-0 mt-1 text-sm text-muted-foreground">
              Authenticate your users through a suite of providers and login methods
            </p>
          </div>

          <Card className="overflow-hidden p-0">
            <div className="flex flex-col">
              {rows.toggle.map((p) => (
                <EmailPhoneToggleRow
                  key={p.key}
                  provider={p}
                  enabled={Boolean(authConfig?.[p.enabledField])}
                  disabled={!isAdmin || !authConfig}
                  onToggle={(next) => save({ [p.enabledField]: next })}
                />
              ))}

              {rows.comingSoonList.map((p) => (
                <ComingSoonRow key={p.key} provider={p} />
              ))}

              {rows.oauth.map((p) => (
                <ProviderRow
                  key={p.key}
                  provider={p}
                  enabled={Boolean(authConfig?.[p.fieldMap.enabled!])}
                  onClick={() => openProvider(p)}
                />
              ))}
            </div>
          </Card>
        </section>

        {rows.comingSoonSection.length > 0 ? (
          <section className="flex flex-col gap-2">
            {rows.comingSoonSection.map((p) => (
              <div key={p.key} className="flex flex-col gap-2">
                <h3 className="m-0 text-base font-medium">{p.displayName}</h3>
                <p className="m-0 text-sm text-muted-foreground">
                  Configure OAuth/OIDC providers for this project using your own issuer or
                  endpoints. (Tracked in
                  <a
                    href={`https://github.com/kmhari/selfbase/issues/${p.comingSoonIssue}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-1"
                  >
                    #{p.comingSoonIssue}
                  </a>
                  )
                </p>
                <ComingSoonRow provider={p} />
              </div>
            ))}
          </section>
        ) : null}
      </div>

      <Sheet
        open={activeProvider !== null}
        onOpenChange={(open) => {
          if (!open) closeProvider();
        }}
      >
        {activeProvider && authConfig ? (
          <ActiveProviderForm
            provider={activeProvider}
            authConfig={authConfig}
            apex={apex}
            projectRef={ref}
            isAdmin={isAdmin}
            onSave={save}
            onCancel={() => closeProvider()}
          />
        ) : null}
      </Sheet>
    </ProjectShell>
  );
}

function ActiveProviderForm({
  provider,
  authConfig,
  apex,
  projectRef,
  isAdmin,
  onSave,
  onCancel,
}: {
  provider: ActiveOAuthProvider;
  authConfig: AuthConfigResponse;
  apex: string | null;
  projectRef: string;
  isAdmin: boolean;
  onSave: (patchBody: Record<string, unknown>) => void;
  onCancel: () => void;
}): React.ReactElement {
  const commonProps = {
    provider,
    authConfig,
    apex,
    projectRef,
    isAdmin,
    onSave,
    onCancel,
  };
  switch (provider.formTemplate) {
    case 'Google':
      return <GoogleForm {...commonProps} />;
    case 'CommonFour':
      return <CommonFour {...commonProps} />;
    case 'PlusUrl':
      return <PlusUrl {...commonProps} />;
    case 'WorkOsShape':
      return <WorkOsShape {...commonProps} />;
    case 'Apple':
      return <AppleForm {...commonProps} />;
    case 'Oidc':
      return <OidcForm {...commonProps} />;
    default: {
      // Exhaustiveness check — if a new template is added the build fails here.
      const _exhaustive: never = provider.formTemplate;
      return (
        <div className="p-6">
          <p className="m-0 text-sm text-muted-foreground">
            Unknown form template: {String(_exhaustive)}
          </p>
        </div>
      );
    }
  }
}

function splitRegistry(registry: ProviderDef[]) {
  const toggle: Extract<ProviderDef, { kind: 'toggle-only' }>[] = [];
  const oauth: ActiveOAuthProvider[] = [];
  const comingSoonList: Extract<ProviderDef, { kind: 'coming-soon' }>[] = [];
  const comingSoonSection: Extract<ProviderDef, { kind: 'coming-soon' }>[] = [];
  for (const p of registry) {
    if (p.kind === 'toggle-only') toggle.push(p);
    else if (p.kind === 'oauth') oauth.push(p);
    else if (p.placement === 'section') comingSoonSection.push(p);
    else comingSoonList.push(p);
  }
  return { toggle, oauth, comingSoonList, comingSoonSection };
}
