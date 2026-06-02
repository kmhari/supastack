import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { AuthConfigResponse } from '@/lib/api';
import { ToggleRow } from './form-primitives';

/**
 * Top-of-page 4-toggle bundle: Allow signup / Allow manual linking / Allow
 * anonymous sign-ins / Confirm email. Single Save dispatches a single PATCH.
 */
export function GlobalTogglesForm({
  authConfig,
  isAdmin,
  onSave,
}: {
  authConfig: AuthConfigResponse;
  isAdmin: boolean;
  onSave: (patchBody: Record<string, unknown>) => void;
}): React.ReactElement {
  const initial = useMemo(
    () => ({
      allowSignup: !authConfig.disable_signup,
      allowManualLinking: Boolean(authConfig.security_manual_linking_enabled),
      allowAnonymous: Boolean(authConfig.external_anonymous_users_enabled),
      confirmEmail: !authConfig.mailer_autoconfirm,
    }),
    [authConfig],
  );

  const [values, setValues] = useState(initial);
  useEffect(() => setValues(initial), [initial]);

  const dirty =
    values.allowSignup !== initial.allowSignup ||
    values.allowManualLinking !== initial.allowManualLinking ||
    values.allowAnonymous !== initial.allowAnonymous ||
    values.confirmEmail !== initial.confirmEmail;

  function handleSave(): void {
    const patch: Record<string, unknown> = {};
    if (values.allowSignup !== initial.allowSignup) {
      patch.disable_signup = !values.allowSignup;
    }
    if (values.allowManualLinking !== initial.allowManualLinking) {
      patch.security_manual_linking_enabled = values.allowManualLinking;
    }
    if (values.allowAnonymous !== initial.allowAnonymous) {
      patch.external_anonymous_users_enabled = values.allowAnonymous;
    }
    if (values.confirmEmail !== initial.confirmEmail) {
      patch.mailer_autoconfirm = !values.confirmEmail;
    }
    if (Object.keys(patch).length > 0) {
      onSave(patch);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="m-0 text-xl font-normal tracking-tight text-foreground">User Signups</h2>
      <Card className="px-5 py-1">
        <div className="flex flex-col">
          <ToggleRow
            id="global-allow-signup"
            label="Allow new users to sign up"
            description="If this is disabled, new users will not be able to sign up to your application"
            checked={values.allowSignup}
            onChange={(v) => setValues({ ...values, allowSignup: v })}
            disabled={!isAdmin}
          />
          <ToggleRow
            id="global-allow-manual-linking"
            label="Allow manual linking"
            description={
              <>
                Enable{' '}
                <a
                  href="https://supabase.com/docs/guides/auth/auth-identity-linking#manual-linking"
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:no-underline"
                >
                  manual linking APIs
                </a>{' '}
                for your project
              </>
            }
            checked={values.allowManualLinking}
            onChange={(v) => setValues({ ...values, allowManualLinking: v })}
            disabled={!isAdmin}
          />
          <ToggleRow
            id="global-allow-anonymous"
            label="Allow anonymous sign-ins"
            description={
              <>
                Enable{' '}
                <a
                  href="https://supabase.com/docs/guides/auth/auth-anonymous"
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:no-underline"
                >
                  anonymous sign-ins
                </a>{' '}
                for your project
              </>
            }
            checked={values.allowAnonymous}
            onChange={(v) => setValues({ ...values, allowAnonymous: v })}
            disabled={!isAdmin}
          />
          <ToggleRow
            id="global-confirm-email"
            label="Confirm email"
            description="Users will need to confirm their email address before signing in for the first time"
            checked={values.confirmEmail}
            onChange={(v) => setValues({ ...values, confirmEmail: v })}
            disabled={!isAdmin}
          />
        </div>
        {isAdmin ? (
          <div className="flex justify-end border-t border-border-soft py-3">
            <Button
              htmlType="button"
              onClick={handleSave}
              disabled={!dirty}
              className="bg-emerald-700 text-white hover:bg-emerald-600 disabled:bg-emerald-900/40 disabled:text-emerald-200/60"
            >
              Save changes
            </Button>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
