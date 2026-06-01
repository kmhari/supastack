import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { instancesApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputWithSuffix } from '@/components/ui/input-with-suffix';
import { CopyButton } from '@/components/CopyButton';
import {
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { AuthConfigResponse } from '@/lib/api';
import { buildCallbackUrl } from './callback-url';
import type { ActiveOAuthProvider } from './provider-registry';
import { AutofillTrap, FieldRow, ToggleRow } from './form-primitives';
import { ProviderIcon } from './ProviderIcon';

/**
 * Plus-URL form template: CommonFour + URL field for operator-hosted IdPs.
 *
 * Contract: specs/020-auth-providers-dashboard/contracts/provider-form-templates.md §2
 * Task: T040
 *
 * Used by 3 providers:
 *   - azure (tenant URL — `https://login.microsoftonline.com/<tenant-id>/v2.0`)
 *   - gitlab (self-hosted GitLab base URL; omit for gitlab.com)
 *   - keycloak (Keycloak realm URL — `https://<host>/realms/<realm>`)
 */
export function PlusUrl({
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
  apex: string | null | undefined;
  projectRef: string;
  isAdmin: boolean;
  onSave: (patchBody: Record<string, unknown>) => void;
  onCancel: () => void;
}): React.ReactElement {
  const fm = provider.fieldMap;
  const [enabled, setEnabled] = useState<boolean>(Boolean(authConfig[fm.enabled!]));
  const [clientId, setClientId] = useState<string>(String(authConfig[fm.clientId!] ?? ''));
  const [secret, setSecret] = useState<string>('');
  const [url, setUrl] = useState<string>(String(authConfig[fm.url!] ?? ''));
  const [emailOptional, setEmailOptional] = useState<boolean>(
    Boolean(authConfig[fm.emailOptional!]),
  );
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);

  const hasSavedSecret = Boolean(authConfig[fm.secret!]);
  const callbackUrl = buildCallbackUrl(projectRef, apex);

  async function handleReveal(): Promise<void> {
    setRevealing(true);
    try {
      const cfg = await instancesApi.revealAuthConfig(projectRef);
      const val = cfg[fm.secret!] as string | null;
      if (val && val !== '***') {
        setSecret(val);
        setRevealed(true);
      }
    } finally {
      setRevealing(false);
    }
  }

  function handleSave(): void {
    const patch: Record<string, unknown> = {
      [fm.enabled!]: enabled,
      [fm.clientId!]: clientId.trim() || null,
      [fm.url!]: url.trim() || null,
      [fm.emailOptional!]: emailOptional,
    };
    if (secret.length > 0) patch[fm.secret!] = secret;
    onSave(patch);
  }

  const urlPlaceholder = urlPlaceholderFor(provider.key);

  return (
    <SheetContent>
      <SheetHeader>
        <div className="flex items-center gap-3">
          <ProviderIcon name={provider.key} size="lg" />
          <SheetTitle>{provider.displayName}</SheetTitle>
        </div>
        <SheetDescription>
          Configure Sign in with {provider.displayName} for this project.
        </SheetDescription>
      </SheetHeader>

      <AutofillTrap />

      <SheetBody>
        <ToggleRow
          id={`${provider.key}-enabled`}
          label={`Enable Sign in with ${provider.displayName}`}
          checked={enabled}
          onChange={setEnabled}
          disabled={!isAdmin}
        />

        <FieldRow id={`${provider.key}-client-id`} label={clientIdLabelFor(provider.key)}>
          <Input
            id={`${provider.key}-client-id`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={!isAdmin}
          />
        </FieldRow>

        <FieldRow id={`${provider.key}-secret`} label={secretLabelFor(provider.key)}>
          <InputWithSuffix
            suffix={
              !revealed && hasSavedSecret ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => void handleReveal()}
                  disabled={revealing}
                >
                  {revealing ? 'Loading…' : 'Reveal'}
                </Button>
              ) : undefined
            }
          >
            <Input
              id={`${provider.key}-secret`}
              type={revealed ? 'text' : 'password'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={!isAdmin}
              placeholder={hasSavedSecret ? '••••••••' : 'paste secret here'}
              autoComplete="off"
            />
          </InputWithSuffix>
          <p className="m-0 text-xs text-muted-foreground">Leave blank to keep the saved value.</p>
        </FieldRow>

        <FieldRow id={`${provider.key}-url`} label={urlLabelFor(provider.key)}>
          <Input
            id={`${provider.key}-url`}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!isAdmin}
            placeholder={urlPlaceholder}
            type="url"
          />
          <p className="m-0 text-xs text-muted-foreground">{urlHelpFor(provider.key)}</p>
        </FieldRow>

        <ToggleRow
          id={`${provider.key}-email-optional`}
          label="Allow users without an email"
          checked={emailOptional}
          onChange={setEmailOptional}
          disabled={!isAdmin}
        />

        <FieldRow id={`${provider.key}-callback`} label="Callback URL (for OAuth)">
          <div className="flex items-center gap-2">
            <Input
              id={`${provider.key}-callback`}
              value={callbackUrl}
              readOnly
              className="flex-1 text-muted-foreground"
            />
            <CopyButton value={callbackUrl} variant="outline" size="sm" />
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            Register this callback URL in the {provider.displayName} console.
          </p>
        </FieldRow>
      </SheetBody>

      <SheetFooter>
        <a
          href={provider.docsUrl}
          target="_blank"
          rel="noreferrer"
          className="mr-auto inline-flex items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"
        >
          Docs <ExternalLink className="size-3.5" />
        </a>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={!isAdmin}>
          Save
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}

function clientIdLabelFor(key: string): string {
  if (key === 'azure') return 'Application (client) ID';
  if (key === 'gitlab') return 'Application ID';
  return 'Client ID';
}

function secretLabelFor(key: string): string {
  if (key === 'azure') return 'Secret Value';
  if (key === 'gitlab') return 'Secret';
  if (key === 'keycloak') return 'Secret';
  return 'Client Secret';
}

function urlLabelFor(key: string): string {
  if (key === 'azure') return 'Azure Tenant URL';
  if (key === 'gitlab') return 'Self Hosted GitLab URL';
  if (key === 'keycloak') return 'Realm URL';
  return 'URL';
}

function urlPlaceholderFor(key: string): string {
  if (key === 'azure') return 'https://login.microsoftonline.com/<tenant>/v2.0';
  if (key === 'gitlab') return 'https://gitlab.example.com';
  if (key === 'keycloak') return 'https://auth.example.com/realms/<realm>';
  return 'https://...';
}

function urlHelpFor(key: string): string {
  if (key === 'azure') return 'Azure AD / Entra ID tenant authority URL.';
  if (key === 'gitlab')
    return 'Leave blank for gitlab.com. Set to your self-hosted GitLab URL otherwise.';
  if (key === 'keycloak') return 'Full URL to the Keycloak realm, including `/realms/<realm>`.';
  return '';
}
