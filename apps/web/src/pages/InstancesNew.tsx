import { useState, type FormEvent } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { instancesApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Shell } from '@/components/Shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function InstancesNewPage(): React.ReactElement {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [dbPassword, setDbPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user && user.role !== 'admin') return <Navigate to="/" replace />;

  const generatePassword = (): void => {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let out = '';
    for (const b of bytes) out += charset[b % charset.length];
    setDbPassword(out);
    setShowPassword(true);
  };

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const out = (await instancesApi.create({
        name: name.trim(),
        dbPassword,
      })) as { ref: string };
      navigate(`/p/${out.ref}`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? e.message ?? 'create failed');
    } finally {
      setSubmitting(false);
    }
  };

  const disabled = submitting || !name.trim() || dbPassword.length < 8;

  return (
    <Shell>
      <form onSubmit={(e) => void onSubmit(e)} className="mx-auto max-w-[900px]">
        <Card className="overflow-hidden rounded-lg border border-border-soft bg-card p-0">
          <div className="px-8 pt-7 pb-7">
            <h1 className="m-0 text-[22px] font-medium text-foreground">Create a new project</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Your project will have its own dedicated instance and full Postgres database.
              <br />
              An API will be set up so you can easily interact with your new database.
            </p>
          </div>

          <Separator className="bg-border-soft" />

          <div className="grid grid-cols-[280px_1fr] gap-8 px-8 py-6">
            <Label className="pt-2 text-sm text-foreground">Project name</Label>
            <div>
              <Input
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Project name"
              />
            </div>
          </div>

          <Separator className="bg-border-soft" />

          <div className="grid grid-cols-[280px_1fr] gap-8 px-8 py-6">
            <Label className="pt-2 text-sm text-foreground">Database password</Label>
            <div className="flex flex-col gap-2.5 min-w-0">
              <div className="relative">
                <Input
                  required
                  type={showPassword ? 'text' : 'password'}
                  minLength={8}
                  value={dbPassword}
                  onChange={(e) => setDbPassword(e.target.value)}
                  placeholder="Type in a strong password"
                  className={
                    showPassword ? 'pr-16 font-mono' : 'pr-16'
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1.5 text-xs text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide' : 'Show'}
                >
                  {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <div className="text-sm leading-snug text-muted-foreground">
                This is the password to your Postgres database, so it must be strong and hard to
                guess.{' '}
                <button
                  type="button"
                  onClick={generatePassword}
                  className="bg-transparent p-0 text-sm text-foreground-light underline underline-offset-2 hover:text-foreground"
                >
                  Generate a password
                </button>
                .
              </div>
            </div>
          </div>

          {error && (
            <div className="mx-8 mb-4">
              <Alert variant="destructive">
                <AlertCircle />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border-soft bg-black/15 px-8 py-5">
            <Button type="button" variant="outline" onClick={() => navigate('/')}>
              Cancel
            </Button>
            <Button type="submit" disabled={disabled}>
              {submitting ? 'Creating…' : 'Create new project'}
            </Button>
          </div>
        </Card>
      </form>
    </Shell>
  );
}
