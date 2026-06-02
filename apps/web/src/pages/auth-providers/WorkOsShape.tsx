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
 * WorkOS-shape form template: enable + client_id + secret + url. NO
 * `email_optional` toggle (WorkOS does not expose this concept).
 *
 * Contract: specs/020-auth-providers-dashboard/contracts/provider-form-templates.md §3
 * Task: T041
 */
export function WorkOsShape({
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
  const [revealed, setRevealed] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<string | null>(null);

  const hasSavedSecret = authConfig[fm.secret!] !== null && authConfig[fm.secret!] !== undefined;
  const callbackUrl = buildCallbackUrl(projectRef, apex);

  async function handleReveal(): Promise<void> {
    setRevealing(true);
    setRevealError(null);
    try {
      const cfg = await instancesApi.revealAuthConfig(projectRef);
      const val = cfg[fm.secret!] as string | null;
      if (val && val !== '***') {
        setSecret(val);
        setRevealed(true);
      }
    } catch {
      setRevealError('Failed to load secret. Try again.');
    } finally {
      setRevealing(false);
    }
  }

  function handleSave(): void {
    const patch: Record<string, unknown> = {
      [fm.enabled!]: enabled,
      [fm.clientId!]: clientId.trim() || null,
      [fm.url!]: url.trim() || null,
    };
    if (secret.length > 0) patch[fm.secret!] = secret;
    onSave(patch);
  }

  return (
    <SheetContent>
      <SheetHeader>
        <div className="flex items-center gap-3">
          <ProviderIcon name={provider.key} size="lg" />
          <SheetTitle>WorkOS</SheetTitle>
        </div>
        <SheetDescription>
          Configure Sign in with WorkOS for this project. WorkOS Single Sign-On uses your
          organization's identity provider.
        </SheetDescription>
      </SheetHeader>

      <AutofillTrap />

      <SheetBody>
        <ToggleRow
          id="workos-enabled"
          label="Enable Sign in with WorkOS"
          checked={enabled}
          onChange={setEnabled}
          disabled={!isAdmin}
        />

        <FieldRow id="workos-client-id" label="Client ID">
          <Input
            id="workos-client-id"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            disabled={!isAdmin}
            placeholder="client_01H..."
          />
        </FieldRow>

        <FieldRow id="workos-secret" label="Secret Key">
          <InputWithSuffix
            suffix={
              !revealed && hasSavedSecret ? (
                <Button
                  htmlType="button"
                  type="text"
                  size="tiny"
                  onClick={() => void handleReveal()}
                  disabled={revealing}
                >
                  {revealing ? 'Loading…' : 'Reveal'}
                </Button>
              ) : undefined
            }
          >
            <Input
              id="workos-secret"
              type={revealed ? 'text' : 'password'}
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              disabled={!isAdmin}
              placeholder={hasSavedSecret ? '••••••••' : 'paste secret here'}
              autoComplete="off"
            />
          </InputWithSuffix>
          {revealError && (
            <p className="m-0 mt-1 text-sm text-destructive">{revealError}</p>
          )}
          <p className="m-0 text-xs text-muted-foreground">Leave blank to keep the saved value.</p>
        </FieldRow>

        <FieldRow id="workos-url" label="WorkOS URL">
          <Input
            id="workos-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!isAdmin}
            placeholder="https://api.workos.com"
            type="url"
          />
          <p className="m-0 text-xs text-muted-foreground">
            Defaults to `https://api.workos.com`. Override only if you're routed to a regional
            endpoint.
          </p>
        </FieldRow>

        <FieldRow id="workos-callback" label="Callback URL (for OAuth)">
          <div className="flex items-center gap-2">
            <Input
              id="workos-callback"
              value={callbackUrl}
              readOnly
              className="flex-1 text-muted-foreground"
            />
            <CopyButton value={callbackUrl} variant="outline" size="sm" />
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            Register this callback URL as a redirect URI in your WorkOS dashboard.
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
        <Button htmlType="button" type="default" onClick={onCancel}>
          Cancel
        </Button>
        <Button htmlType="button" onClick={handleSave} disabled={!isAdmin}>
          Save
        </Button>
      </SheetFooter>
    </SheetContent>
  );
}
