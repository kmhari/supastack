/**
 * Auth → Hooks page.
 *
 * Spec: specs/082-auth-hooks/spec.md US3
 * Plan: specs/082-auth-hooks/plan.md §D
 */
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ProjectShell } from '@/components/ProjectShell';
import { Card } from '@/components/ui/card';
import { authConfigApi, type AuthConfigResponse } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useRestartToast } from './auth-providers/use-restart-toast';
import { HookForm } from './auth-hooks/HookForm';

const HOOK_DEFS = [
  {
    hookType: 'custom_access_token',
    label: 'Custom Access Token',
    description:
      'Run a Postgres function before GoTrue issues a JWT. Add custom claims or modify token shape.',
  },
  {
    hookType: 'mfa_verification_attempt',
    label: 'MFA Verification Attempt',
    description:
      'Observe or reject MFA verification attempts before GoTrue validates them.',
  },
  {
    hookType: 'password_verification_attempt',
    label: 'Password Verification Attempt',
    description:
      'Observe or reject password sign-in attempts. Useful for rate-limiting or audit logging.',
  },
  {
    hookType: 'send_email',
    label: 'Send Email',
    description:
      'Replace the built-in mailer with a custom sender. Your function receives the email payload.',
  },
  {
    hookType: 'send_sms',
    label: 'Send SMS',
    description:
      'Replace the built-in SMS sender with a custom function for OTP delivery.',
  },
  {
    hookType: 'before_user_created',
    label: 'Before User Created',
    description:
      'Validate or reject a new user signup before the user record is written.',
  },
  {
    hookType: 'after_user_created',
    label: 'After User Created',
    description:
      'React to new user creation — provision resources, send welcome events, etc.',
  },
] as const;

export function ProjectAuthHooksPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data: authConfig } = useQuery<AuthConfigResponse>({
    queryKey: ['auth-config', ref],
    queryFn: () => authConfigApi.get(ref),
    enabled: Boolean(ref),
  });

  const save = useRestartToast(ref);

  return (
    <ProjectShell
      title="Auth Hooks"
      subtitle="Attach Postgres functions to authentication events using pg-functions:// URIs"
    >
      <div className="flex flex-col gap-6">
        <div>
          <p className="m-0 text-sm text-muted-foreground">
            Auth hooks let you run custom Postgres functions on authentication events. Write a
            plpgsql function in your project database and point the hook at it using a{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              pg-functions://postgres/public/&lt;func_name&gt;
            </code>{' '}
            URI.
          </p>
        </div>

        <Card className="overflow-hidden p-0">
          <div className="px-5">
            {HOOK_DEFS.map(({ hookType, label, description }) => (
              <HookForm
                key={hookType}
                hookType={hookType}
                label={label}
                description={description}
                config={authConfig}
                isAdmin={isAdmin}
                onSave={save}
              />
            ))}
          </div>
        </Card>
      </div>
    </ProjectShell>
  );
}
