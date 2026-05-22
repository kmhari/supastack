import { useState } from 'react';
import { instancesApi } from '@/lib/api';

export interface Credentials {
  ref: string;
  anonKey: string;
  serviceRoleKey: string;
  jwtSecret: string;
  postgresPassword: string;
  dashboardPassword: string;
  connectionStrings: Record<string, string>;
}

/**
 * Re-auth + credentials reveal flow shared by ProjectApiKeys and
 * ProjectJwtKeys (and any future secret-bearing settings page).
 *
 * Both pages need to gate their secrets behind a "type your password"
 * dialog. This hook owns the dialog state, the password input, the
 * error display, and the resulting Credentials blob.
 */
export function useRevealCredentials(ref: string): {
  creds: Credentials | null;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  password: string;
  setPassword: (p: string) => void;
  error: string | null;
  reveal: () => Promise<void>;
  pending: boolean;
} {
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const reveal = async (): Promise<void> => {
    setError(null);
    setPending(true);
    try {
      const out = (await instancesApi.reveal(ref, { password })) as Credentials;
      setCreds(out);
      setDialogOpen(false);
      setPassword('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? 'reveal failed');
    } finally {
      setPending(false);
    }
  };

  return {
    creds,
    dialogOpen,
    openDialog: () => {
      setError(null);
      setDialogOpen(true);
    },
    closeDialog: () => setDialogOpen(false),
    password,
    setPassword,
    error,
    reveal,
    pending,
  };
}
