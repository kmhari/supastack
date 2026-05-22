import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { membersApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function AcceptInvitePage(): React.ReactElement {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { refresh } = useAuth();

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!token) {
      setError('missing token');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await membersApi.acceptInvite({ token, password });
      await refresh();
      navigate('/dashboard');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? e.message ?? 'accept failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 font-sans">
      <form onSubmit={(e) => void onSubmit(e)} className="flex w-96 max-w-full flex-col gap-4">
        <div className="mb-2 flex items-center gap-2.5">
          <span aria-hidden className="inline-block size-7 rounded-md bg-success" />
          <span className="text-base font-medium">Selfbase</span>
        </div>

        <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">Accept invite</h1>
        <p className="m-0 text-sm text-muted-foreground">
          Set your password to join the organization.
        </p>

        <div>
          <Label htmlFor="password" className="mb-1.5 block text-sm text-foreground-light">
            New password
          </Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="min 8 chars"
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button disabled={submitting} type="submit" className="w-full">
          {submitting ? 'Joining…' : 'Join'}
        </Button>
      </form>
    </div>
  );
}
