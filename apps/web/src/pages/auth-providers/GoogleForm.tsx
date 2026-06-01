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
 * Google OAuth provider drawer.
 *
 * Contract: specs/020-auth-providers-dashboard/contracts/provider-form-templates.md §4
 * Tasks: T015, T016
 *
 * Reveal button (T016) is a disabled placeholder — admin-only plaintext fetch
 * for an existing saved secret is tracked separately in #73.
 */
export function GoogleForm({
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
  // Seed form state from the current auth-config. Secrets are masked in GET
  // (FR-009), so the secret input starts blank — operators re-paste to update.
  const fm = provider.fieldMap;
  const [enabled, setEnabled] = useState<boolean>(Boolean(authConfig[fm.enabled!]));
  const [clientIds, setClientIds] = useState<string>(
    joinClientIds(
      authConfig[fm.clientId!] as string | null | undefined,
      authConfig[fm.additionalClientIds!] as string | null | undefined,
    ),
  );
  const [secret, setSecret] = useState<string>('');
  const [skipNonceCheck, setSkipNonceCheck] = useState<boolean>(
    Boolean(authConfig[fm.skipNonceCheck!]),
  );
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
    const { primary, additional } = splitClientIds(clientIds);
    const patch: Record<string, unknown> = {
      [fm.enabled!]: enabled,
      [fm.clientId!]: primary,
      [fm.additionalClientIds!]: additional,
      [fm.skipNonceCheck!]: skipNonceCheck,
      [fm.emailOptional!]: emailOptional,
    };
    // Only send the secret if the user typed one — empty input means "leave
    // the saved secret unchanged" (Cloud convention).
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
          Enables Sign in with Google on the web using OAuth or One Tap, or in Android apps or
          Chrome extensions.
        </SheetDescription>
      </SheetHeader>

      <AutofillTrap />

      <SheetBody>
        <ToggleRow
          id="google-enabled"
          label="Enable Sign in with Google"
          checked={enabled}
          onChange={setEnabled}
          disabled={!isAdmin}
        />

        <FieldRow id="google-client-ids" label="Client IDs">
          <Input
            id="google-client-ids"
            value={clientIds}
            onChange={(e) => setClientIds(e.target.value)}
            disabled={!isAdmin}
            placeholder="1234.apps.googleusercontent.com"
          />
          <p className="m-0 text-xs text-muted-foreground">
            Comma-separated list of client IDs for Web, OAuth, Android apps, One Tap, and Chrome
            extensions.
          </p>
        </FieldRow>

        <FieldRow id="google-secret" label="Client Secret (for OAuth)">
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
              id="google-secret"
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
            Client Secret to use with the OAuth flow on the web. Leave blank to keep the saved
            value.
          </p>
        </FieldRow>

        <ToggleRow
          id="google-skip-nonce"
          label="Skip nonce checks"
          checked={skipNonceCheck}
          onChange={setSkipNonceCheck}
          disabled={!isAdmin}
          description="Allows ID tokens with any nonce to be accepted, which is less secure. Useful in situations where you cannot generate a nonce."
        />

        <ToggleRow
          id="google-email-optional"
          label="Allow users without an email"
          checked={emailOptional}
          onChange={setEmailOptional}
          disabled={!isAdmin}
          description="Allows the user to successfully authenticate when the provider does not return an email address."
        />

        <FieldRow id="google-callback" label="Callback URL (for OAuth)">
          <div className="flex items-center gap-2">
            <Input
              id="google-callback"
              value={callbackUrl}
              readOnly
              className="flex-1 text-muted-foreground"
            />
            <CopyButton value={callbackUrl} variant="outline" size="sm" />
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            Register this callback URL when using Sign-in with Google on the web using OAuth.
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

// ─── helpers ────────────────────────────────────────────────────────────────

function joinClientIds(
  primary: string | null | undefined,
  additional: string | null | undefined,
): string {
  const head = (primary ?? '').trim();
  const tail = (additional ?? '').trim();
  if (!head && !tail) return '';
  if (!tail) return head;
  if (!head) return tail;
  return `${head},${tail}`;
}

function splitClientIds(input: string): { primary: string | null; additional: string | null } {
  const items = input
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return { primary: null, additional: null };
  const [primary, ...rest] = items;
  return {
    primary: primary ?? null,
    additional: rest.length > 0 ? rest.join(',') : null,
  };
}
