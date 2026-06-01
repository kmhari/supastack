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
 * Apple form template: Apple uses "Services ID" terminology (a flavor of
 * Client ID) plus an "Additional Services IDs" field for apps targeting
 * multiple Apple platforms.
 *
 * Contract: specs/020-auth-providers-dashboard/contracts/provider-form-templates.md §5
 * Task: T042
 */
export function AppleForm({
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
  const [servicesId, setServicesId] = useState<string>(String(authConfig[fm.clientId!] ?? ''));
  const [additionalIds, setAdditionalIds] = useState<string>(
    String(authConfig[fm.additionalClientIds!] ?? ''),
  );
  const [secret, setSecret] = useState<string>('');
  const [emailOptional, setEmailOptional] = useState<boolean>(
    Boolean(authConfig[fm.emailOptional!]),
  );
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
      [fm.clientId!]: servicesId.trim() || null,
      [fm.additionalClientIds!]: additionalIds.trim() || null,
      [fm.emailOptional!]: emailOptional,
    };
    if (secret.length > 0) patch[fm.secret!] = secret;
    onSave(patch);
  }

  return (
    <SheetContent>
      <SheetHeader>
        <div className="flex items-center gap-3">
          <ProviderIcon name={provider.key} size="lg" />
          <SheetTitle>Apple</SheetTitle>
        </div>
        <SheetDescription>Configure Sign in with Apple for this project.</SheetDescription>
      </SheetHeader>

      <AutofillTrap />

      <SheetBody>
        <ToggleRow
          id="apple-enabled"
          label="Enable Sign in with Apple"
          checked={enabled}
          onChange={setEnabled}
          disabled={!isAdmin}
        />

        <FieldRow id="apple-services-id" label="Services ID">
          <Input
            id="apple-services-id"
            value={servicesId}
            onChange={(e) => setServicesId(e.target.value)}
            disabled={!isAdmin}
            placeholder="com.example.signin"
          />
          <p className="m-0 text-xs text-muted-foreground">
            The primary Apple Services ID configured in the Apple Developer console.
          </p>
        </FieldRow>

        <FieldRow id="apple-additional-ids" label="Additional Services IDs">
          <Input
            id="apple-additional-ids"
            value={additionalIds}
            onChange={(e) => setAdditionalIds(e.target.value)}
            disabled={!isAdmin}
            placeholder="com.example.ios,com.example.macos"
          />
          <p className="m-0 text-xs text-muted-foreground">
            Comma-separated additional Apple Services / App IDs (iOS bundle IDs etc.) you want to
            accept tokens from.
          </p>
        </FieldRow>

        <FieldRow id="apple-secret" label="Secret Key (for OAuth)">
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
              id="apple-secret"
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
          <p className="m-0 text-xs text-muted-foreground">
            The signed JWT secret generated from your Apple Developer signing key. Leave blank to
            keep the saved value.
          </p>
        </FieldRow>

        <ToggleRow
          id="apple-email-optional"
          label="Allow users without an email"
          checked={emailOptional}
          onChange={setEmailOptional}
          disabled={!isAdmin}
        />

        <FieldRow id="apple-callback" label="Callback URL (for OAuth)">
          <div className="flex items-center gap-2">
            <Input
              id="apple-callback"
              value={callbackUrl}
              readOnly
              className="flex-1 text-muted-foreground"
            />
            <CopyButton value={callbackUrl} variant="outline" size="sm" />
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            Register this callback URL in the Apple Developer console under the Services ID's Web
            Authentication settings.
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
