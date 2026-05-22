import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { setupApi } from '../lib/api.js';

/**
 * Public-route wrapper that bounces a fresh installer to /setup when
 * the super-admin doesn't exist yet. Mirrors the inverse check inside
 * RequireAuth, but for routes (like /login, /accept-invite) that don't
 * sit behind auth and would otherwise render despite an open setup.
 */
export function SetupGate({ children }: { children: ReactNode }): React.ReactElement {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    setupApi
      .status()
      .then((r) => setOpen(r.open))
      .catch(() => setOpen(false));
  }, []);
  if (open === null) return <></>;
  if (open) return <Navigate to="/setup" replace />;
  return <>{children}</>;
}
