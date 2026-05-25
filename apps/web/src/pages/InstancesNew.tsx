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

  if (user && user.role !== 'admin') return <Navigate to="/dashboard" replace />;

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
      navigate(`/dashboard/project/${out.ref}`);
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
      <form onSubmit={(e) => void onSubmit(e)} className="mx-auto max-w-[960px]">
        <Card className="overflow-hidden rounded-lg border border-border-soft bg-card p-0 gap-0">
          <div className="px-4 py-5 sm:px-10 sm:py-8">
            <h1 className="m-0 text-[22px] font-medium text-foreground">Create a new project</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Your project will have its own dedicated instance and full Postgres database. An API
              will be set up so you can easily interact with your new database.
            </p>
          </div>

          <Separator className="bg-border-soft" />

          <FormRow label="Project name">
            <Input
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
            />
          </FormRow>

          <Separator className="bg-border-soft" />

          <FormRow
            label="Database password"
            hint={
              <>
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
              </>
            }
          >
            <div className="relative">
              <Input
                required
                type={showPassword ? 'text' : 'password'}
                minLength={8}
                value={dbPassword}
                onChange={(e) => setDbPassword(e.target.value)}
                placeholder="Type in a strong password"
                className={showPassword ? 'pr-12 font-mono' : 'pr-12'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? 'Hide' : 'Show'}
              >
                {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </FormRow>

          {error && (
            <>
              <Separator className="bg-border-soft" />
              <div className="px-4 py-4 sm:px-10 sm:py-5">
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            </>
          )}

          <Separator className="bg-border-soft" />

          <div className="flex flex-col-reverse gap-2 bg-black/15 px-4 py-4 sm:flex-row sm:justify-end sm:px-10 sm:py-5">
            <Button type="button" variant="outline" onClick={() => navigate('/dashboard')}>
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

function FormRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-3 px-4 py-5 sm:grid sm:grid-cols-[260px_1fr] sm:items-start sm:gap-10 sm:px-10 sm:py-8 lg:grid-cols-[320px_1fr]">
      <Label className="text-sm font-normal text-foreground sm:pt-2">{label}</Label>
      <div className="flex min-w-0 flex-col gap-3">
        {children}
        {hint && <div className="text-sm leading-relaxed text-muted-foreground">{hint}</div>}
      </div>
    </div>
  );
}
