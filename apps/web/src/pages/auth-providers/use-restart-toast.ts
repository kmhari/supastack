import { useCallback } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { authConfigApi } from '@/lib/api';
import { pollUntilHealthy, TimeoutError } from '@/lib/health-poll';

/**
 * Orchestrates the restart-toast flow used by every Save action on the Auth
 * Providers page. Returns a stable `save` callback that:
 *   1. Closes the drawer (caller-supplied `closeDrawer`)
 *   2. Shows a loading toast "Restarting auth — ~30s"
 *   3. PATCHes auth-config
 *   4. Polls the per-instance health endpoint until `running`
 *   5. Flips toast to success and invalidates the auth-config cache so the
 *      providers list refetches and the status pill flips
 *   6. On failure, shows an error toast with a Retry action
 *
 * Spec: specs/020-auth-providers-dashboard/spec.md FR-017, FR-018, FR-019
 * Plan: specs/020-auth-providers-dashboard/plan.md §C4
 * Task: T013
 */
export function useRestartToast(ref: string, closeDrawer?: () => void) {
  const qc = useQueryClient();

  return useCallback(
    async function save(patchBody: Record<string, unknown>): Promise<void> {
      const toastId = toast.loading('Restarting auth — your changes will be live in ~30s');
      closeDrawer?.();
      try {
        await authConfigApi.patch(ref, patchBody);
        await pollUntilHealthy(ref, { timeoutMs: 60_000 });
        toast.success('Settings applied', { id: toastId });
        await qc.invalidateQueries({ queryKey: ['auth-config', ref] });
        await qc.invalidateQueries({ queryKey: ['instance', ref] });
      } catch (err) {
        const message =
          err instanceof TimeoutError
            ? 'Auth container did not become healthy within 60s'
            : err instanceof Error
              ? err.message
              : 'Restart failed';
        toast.error(message, {
          id: toastId,
          action: {
            label: 'Retry',
            onClick: () => {
              void save(patchBody);
            },
          },
        });
      }
    },
    [ref, qc, closeDrawer],
  );
}
