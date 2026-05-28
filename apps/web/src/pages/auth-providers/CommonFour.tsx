import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
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
 * Common-4 form template: enable + client_id + secret + email_optional + callback URL.
 *
 * Contract: specs/020-auth-providers-dashboard/contracts/provider-form-templates.md §1
 * Task: T039
 *
 * Used by 12 providers: bitbucket, discord, facebook, figma, github, kakao,
 * notion, slack-legacy, spotify, twitch, twitter, x, zoom (the github row
 * reuses this template through the registry).
 */
export function CommonFour({
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
  const [emailOptional, setEmailOptional] = useState<boolean>(
    Boolean(authConfig[fm.emailOptional!]),
  );

  const callbackUrl = buildCallbackUrl(projectRef, apex);

  function handleSave(): void {
    const patch: Record<string, unknown> = {
      [fm.enabled!]: enabled,
      [fm.clientId!]: clientId.trim() || null,
      [fm.emailOptional!]: emailOptional,
    };
    if (secret.length > 0) {
      patch[fm.secret!] = secret;
    }
    onSave(patch);
  }

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
            placeholder="Your OAuth client ID"
          />
        </FieldRow>

        <FieldRow id={`${provider.key}-secret`} label={secretLabelFor(provider.key)}>
          <InputWithSuffix
            suffix={
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled
                title="Reveal coming soon — see #73"
              >
                Reveal
              </Button>
            }
          >
            <Input
              id={`${provider.key}-secret`}
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={!isAdmin}
              placeholder={authConfig[fm.secret!] === null ? '••••••••' : 'paste secret here'}
              autoComplete="off"
            />
          </InputWithSuffix>
          <p className="m-0 text-xs text-muted-foreground">Leave blank to keep the saved value.</p>
        </FieldRow>

        <ToggleRow
          id={`${provider.key}-email-optional`}
          label="Allow users without an email"
          checked={emailOptional}
          onChange={setEmailOptional}
          disabled={!isAdmin}
          description="Allows the user to authenticate when the provider does not return an email."
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
            Register this callback URL in the {provider.displayName} OAuth console.
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
  if (key === 'bitbucket') return 'Key';
  if (key === 'facebook') return 'Facebook client ID';
  if (key === 'kakao') return 'REST API Key';
  if (key === 'notion') return 'OAuth client ID';
  if (key === 'twitter') return 'API Key';
  return 'Client ID';
}

function secretLabelFor(key: string): string {
  if (key === 'bitbucket') return 'Secret';
  if (key === 'facebook') return 'Facebook secret';
  if (key === 'kakao') return 'Client Secret Code';
  if (key === 'notion') return 'OAuth client secret';
  if (key === 'twitter') return 'API Secret Key';
  return 'Client Secret';
}
