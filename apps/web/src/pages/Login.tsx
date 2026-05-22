import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function LoginPage(): React.ReactElement {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? 'invalid credentials');
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

        <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">Welcome back</h1>
        <p className="m-0 text-sm text-muted-foreground">Sign in to your selfbase account.</p>

        <div>
          <Label htmlFor="email" className="mb-1.5 block text-sm text-foreground-light">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <Label htmlFor="password" className="mb-1.5 block text-sm text-foreground-light">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>

        <div className="mt-1 text-center text-sm">
          <span className="text-muted-foreground">New here? </span>
          <a
            href="/setup"
            className="border-b border-border text-foreground no-underline hover:border-foreground-light"
          >
            Complete first-time setup →
          </a>
        </div>
      </form>
    </div>
  );
}
