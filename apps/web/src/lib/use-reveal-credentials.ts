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

export function useRevealCredentials(ref: string): {
  creds: Credentials | null;
  reveal: () => Promise<void>;
  pending: boolean;
  error: string | null;
} {
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async (): Promise<void> => {
    setError(null);
    setPending(true);
    try {
      const out = (await instancesApi.reveal(ref)) as Credentials;
      setCreds(out);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? 'reveal failed');
    } finally {
      setPending(false);
    }
  };

  return { creds, reveal, pending, error };
}
