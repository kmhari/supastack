import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { isInstallationAdmin } from '@/lib/api';

/**
 * Client-side gate for /admin: only an installation admin (role 'admin', i.e.
 * owner/administrator) may see the console. This is UX only — the authoritative
 * check is server-side on every /api/v1/admin/* request (FR-009). The session is
 * reused from the dashboard (authApi.me + session cookie); no separate login.
 * Feature 116 (US2).
 */
export function AdminGuard({ children }: { children: ReactNode }): React.ReactElement {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-foreground-light">
        <Loader2 className="size-4 animate-spin" /> Checking access…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="py-16 text-sm text-foreground-light">
        <p className="font-medium text-foreground">Sign in required</p>
        <p className="mt-1">
          Sign in to your{' '}
          <a href="/dashboard" className="text-brand-600 underline">
            dashboard
          </a>
          , then return to the admin console.
        </p>
      </div>
    );
  }

  if (!isInstallationAdmin(user.role)) {
    return (
      <div className="py-16 text-sm text-foreground-light">
        <p className="font-medium text-foreground">Not authorized</p>
        <p className="mt-1">
          The admin console requires an Owner or Administrator role (you are{' '}
          {user.role.replace('_', ' ')}).
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
