import { useEffect, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Terminal, AlertTriangle, Check, Copy } from 'lucide-react';
import { cliLoginApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * /dashboard/cli/login — the page the supabase CLI opens in the browser.
 *
 * State machine (per specs/011-cli-device-login/contracts/dashboard-page.md):
 *   - "loading"      → initial mount, mint POST in flight
 *   - "code-display" → 200 from mint; show 8-char verification code
 *   - "error"        → 409/422/5xx, malformed query params, or no-cookie
 *                      bounce already handled by RequireAuth wrapper
 *
 * Wrapped in <RequireAuth> at the route layer, so unauthenticated visitors
 * are bounced to /login?next=<this-url-with-query> automatically.
 *
 * Spec: specs/011-cli-device-login/contracts/dashboard-page.md
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PUBKEY_RE = /^04[0-9a-f]{128}$/;

type State =
  | { kind: 'loading' }
  | { kind: 'code-display'; code: string }
  | { kind: 'error'; message: string };

export function CliLoginPage(): React.ReactElement {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [copied, setCopied] = useState(false);
  const mintedRef = useRef(false);

  useEffect(() => {
    // Only mint once per mount — React 18 StrictMode double-invokes effects.
    if (mintedRef.current) return;
    mintedRef.current = true;

    // If we already have ?device_code= in the URL (post-replaceState reload),
    // we don't have the session_id/public_key needed to mint again. Treat
    // a refresh on the code-display URL as "session already used" — render
    // the error state so the operator re-runs `supabase login`.
    const existingDeviceCode = params.get('device_code');
    if (existingDeviceCode && !params.get('session_id')) {
      setState({
        kind: 'error',
        message:
          'This CLI sign-in session has already been started. Re-run `supabase login` in your terminal to get a fresh one.',
      });
      return;
    }

    const session_id = params.get('session_id') ?? '';
    const token_name = params.get('token_name') ?? '';
    const public_key = params.get('public_key') ?? '';

    if (!UUID_RE.test(session_id)) {
      setState({
        kind: 'error',
        message:
          'The CLI sign-in link is malformed (invalid session_id). Re-run `supabase login` to get a fresh one.',
      });
      return;
    }
    if (token_name.length === 0 || token_name.length > 200) {
      setState({
        kind: 'error',
        message: 'The CLI sign-in link is malformed (invalid token_name).',
      });
      return;
    }
    if (!PUBKEY_RE.test(public_key)) {
      setState({
        kind: 'error',
        message: 'The CLI sign-in link is malformed (invalid public_key).',
      });
      return;
    }

    cliLoginApi
      .mint({ session_id, token_name, public_key })
      .then(({ device_code }) => {
        // Drop sensitive params from URL bar; keep device_code for friendliness.
        window.history.replaceState({}, '', `/dashboard/cli/login?device_code=${device_code}`);
        setState({ kind: 'code-display', code: device_code });
      })
      .catch((err: unknown) => {
        const e = err as { response?: { data?: { error?: { code?: string; message?: string } } } };
        const code = e.response?.data?.error?.code;
        const message =
          code === 'session_in_use'
            ? 'supastack could not create the CLI sign-in session. Error: Could not create CLI login session'
            : (e.response?.data?.error?.message ??
              'supastack could not create the CLI sign-in session.');
        setState({ kind: 'error', message });
      });
  }, [params]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 font-sans">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center justify-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-secondary">
            <Terminal className="size-5" />
          </span>
          <span aria-hidden className="text-muted-foreground">
            ⇄
          </span>
          <span className="grid size-10 place-items-center rounded-md bg-success/10">
            <span className="size-5 rounded bg-success" />
          </span>
        </div>

        {state.kind === 'loading' && <LoadingState />}
        {state.kind === 'code-display' && (
          <CodeDisplay
            code={state.code}
            email={user?.email ?? null}
            copied={copied}
            onCopy={() => {
              void navigator.clipboard.writeText(state.code).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              });
            }}
          />
        )}
        {state.kind === 'error' && <ErrorState message={state.message} />}
      </Card>
    </div>
  );
}

function LoadingState(): React.ReactElement {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground" role="status">
      Authorizing…
    </div>
  );
}

function CodeDisplay({
  code,
  email,
  copied,
  onCopy,
}: {
  code: string;
  email: string | null;
  copied: boolean;
  onCopy: () => void;
}): React.ReactElement {
  return (
    <>
      <h1 className="m-0 text-center text-xl font-medium">Authorize supastack CLI</h1>
      <p className="mb-6 mt-2 text-center text-sm text-muted-foreground">
        Enter this verification code in supastack CLI to finish signing in
      </p>

      <div role="group" aria-label="Verification code" className="mb-4 flex justify-center gap-2">
        {code.split('').map((char, i) => (
          <div
            key={i}
            className="grid size-10 place-items-center rounded-md border border-border bg-secondary/50 font-mono text-lg font-medium"
          >
            <code>{char}</code>
          </div>
        ))}
      </div>

      <Button htmlType="button" onClick={onCopy} className="mb-6 w-full" aria-live="polite">
        {copied ? (
          <>
            <Check className="size-4" /> Copied!
          </>
        ) : (
          <>
            <Copy className="size-4" /> Copy code
          </>
        )}
      </Button>

      <div className="mb-4 flex items-center gap-3 rounded-md border border-border-soft bg-secondary/30 px-3 py-2.5">
        <span className="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium">
          {(email ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <div className="text-sm">
          <div className="text-muted-foreground">Signed in as</div>
          <div className="text-foreground">{email ?? '—'}</div>
        </div>
      </div>

      <p className="m-0 text-center text-xs text-muted-foreground">
        After authorizing, you can close this tab or manage tokens like this one in{' '}
        <Link to="/settings/tokens" className="underline">
          Access Tokens
        </Link>
        .
      </p>
    </>
  );
}

function ErrorState({ message }: { message: string }): React.ReactElement {
  return (
    <>
      <h1 className="m-0 text-center text-xl font-medium">Unable to create CLI sign-in</h1>
      <p className="mb-6 mt-2 text-center text-sm text-muted-foreground">
        Retry the sign-in command from supastack CLI
      </p>
      <Alert variant="default" className="mb-4 border-warning/40 bg-warning/10">
        <AlertTriangle className="size-4" />
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button asChild type="outline" className="w-full">
        <Link to="/dashboard">Back to dashboard</Link>
      </Button>
    </>
  );
}
