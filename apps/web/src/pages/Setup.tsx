import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Loader2, AlertTriangle, AlertCircle } from 'lucide-react';
import { apexApi, authApi, orgApi, setupApi, type ApexStatus } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CopyButton } from '@/components/CopyButton';

type Step = 'loading' | 'admin' | 'token' | 'apex-enter' | 'apex-verify';

const masterTokenRef: { current: string | null } = { current: null };

export function SetupPage(): React.ReactElement {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [step, setStep] = useState<Step>('loading');
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    if (bootstrapped) return;
    let cancelled = false;
    (async () => {
      const open = await setupApi
        .status()
        .then((r) => r.open)
        .catch(() => false);
      if (cancelled) return;
      if (open) {
        setStep('admin');
        setBootstrapped(true);
        return;
      }
      let authed = false;
      try {
        await authApi.me();
        authed = true;
      } catch {
        authed = false;
      }
      if (cancelled) return;
      if (!authed) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        const apex = await apexApi.status();
        if (cancelled) return;
        if (!apex.apex) {
          setStep('apex-enter');
        } else if (apex.cert?.issued) {
          navigate('/', { replace: true });
          return;
        } else {
          setStep('apex-verify');
        }
      } catch {
        if (!cancelled) navigate('/', { replace: true });
        return;
      }
      setBootstrapped(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapped, navigate]);

  if (step === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 font-sans">
      {step === 'admin' && (
        <AdminStep
          onCreated={() => setStep('token')}
          setMasterToken={(t) => {
            masterTokenRef.current = t;
          }}
        />
      )}
      {step === 'token' && (
        <TokenStep
          token={masterTokenRef.current ?? ''}
          onContinue={async () => {
            await refresh();
            setStep('apex-enter');
          }}
        />
      )}
      {step === 'apex-enter' && <ApexEnterStep onSaved={() => setStep('apex-verify')} />}
      {step === 'apex-verify' && (
        <ApexVerifyStep
          onIssued={() => navigate('/dashboard')}
          onChangeDomain={() => setStep('apex-enter')}
        />
      )}
    </div>
  );
}

// ─── Step 1: admin form ────────────────────────────────────────────────────

function AdminStep({
  onCreated,
  setMasterToken,
}: {
  onCreated: () => void;
  setMasterToken: (t: string) => void;
}): React.ReactElement {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('Selfbase');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const out = await setupApi.run({ email, password, orgName });
      setMasterToken(out.apiToken);
      onCreated();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? e.message ?? 'setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex w-96 max-w-full flex-col gap-4">
      <Wordmark />
      <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">
        First-time setup
      </h1>
      <p className="m-0 text-sm text-muted-foreground">
        Step 1 of 3 — create the super-admin account for this Selfbase install.
      </p>
      <Field label="Email">
        <Input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </Field>
      <Field label="Password" hint="minimum 8 characters">
        <Input
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••••"
        />
      </Field>
      <Field label="Organization name">
        <Input required value={orgName} onChange={(e) => setOrgName(e.target.value)} />
      </Field>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? 'Creating…' : 'Create super-admin'}
      </Button>
    </form>
  );
}

// ─── Step 2: master-token reveal ───────────────────────────────────────────

function TokenStep({
  token,
  onContinue,
}: {
  token: string;
  onContinue: () => void;
}): React.ReactElement {
  return (
    <div className="flex w-96 max-w-full flex-col gap-5">
      <Wordmark />
      <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">Master API token</h1>
      <p className="m-0 text-sm text-muted-foreground">
        Step 2 of 3 — shown once and not recoverable. Copy it before continuing. You can always
        mint more later in Settings.
      </p>
      <pre className="m-0 overflow-x-auto rounded-md border border-border bg-card p-3.5 font-mono text-sm break-all whitespace-pre-wrap text-success">
        {token}
      </pre>
      <div className="flex gap-2">
        <CopyButton value={token} label="Copy token" variant="secondary" size="default" />
        <Button onClick={() => void onContinue()} className="flex-1">
          Continue → Set up domain
        </Button>
      </div>
    </div>
  );
}

// ─── Step 3a: apex domain input ────────────────────────────────────────────

function ApexEnterStep({ onSaved }: { onSaved: () => void }): React.ReactElement {
  const [apex, setApex] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apexApi.status().then((r) => {
      if (r.apex) setApex(r.apex);
    });
  }, []);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await orgApi.patch({ apexDomain: apex.trim() });
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? e.message ?? 'save failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="flex w-96 max-w-full flex-col gap-4">
      <Wordmark />
      <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">
        Connect your domain
      </h1>
      <p className="m-0 text-sm text-muted-foreground">
        Step 3 of 3 — your Selfbase dashboard and instance subdomains will live under this apex.
        Pick something you control DNS for, like <code>selfbase.example.com</code>. Required.
      </p>
      <Field label="Apex domain">
        <Input
          required
          value={apex}
          onChange={(e) => setApex(e.target.value)}
          placeholder="selfbase.example.com"
          autoFocus
        />
      </Field>
      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save & verify DNS'}
      </Button>
    </form>
  );
}

// ─── Step 3b: DNS verify + cert issuance ────────────────────────────────────

function ApexVerifyStep({
  onIssued,
  onChangeDomain,
}: {
  onIssued: () => void;
  onChangeDomain: () => void;
}): React.ReactElement {
  const [status, setStatus] = useState<ApexStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advancedRef = useRef(false);

  const fetchStatus = async (forced = false): Promise<ApexStatus | null> => {
    try {
      setError(null);
      const next = forced ? await apexApi.recheck() : await apexApi.status();
      setStatus(next);
      return next;
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message ?? 'status fetch failed');
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetchStatus(false);
    const id = setInterval(() => {
      if (cancelled) return;
      if (status?.dnsResolved && status.cert?.issued) return;
      void fetchStatus(false);
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (advancedRef.current) return;
    if (status?.dnsResolved && status.cert?.issued) {
      advancedRef.current = true;
      const t = setTimeout(onIssued, 800);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [status, onIssued]);

  const onRecheck = async (): Promise<void> => {
    setRefreshing(true);
    try {
      await fetchStatus(true);
    } finally {
      setRefreshing(false);
    }
  };

  const onIssue = async (): Promise<void> => {
    setIssuing(true);
    setError(null);
    try {
      const next = await apexApi.issue();
      setStatus(next);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setError(e.response?.data?.error?.message ?? e.message ?? 'cert issuance failed');
    } finally {
      setIssuing(false);
    }
  };

  if (!status) {
    return (
      <div className="flex w-[28rem] max-w-full flex-col gap-2">
        <Wordmark />
        <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">
          Verifying domain…
        </h1>
        {error && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  const apex = status.apex ?? '';
  const expectedIp = status.expectedIp ?? '<your-server-ip>';
  const httpsState = !status.dnsResolved
    ? 'waiting'
    : status.cert?.issued
      ? 'ok'
      : status.cert?.selfSigned
        ? 'error'
        : 'pending';

  return (
    <div className="flex w-[28rem] max-w-full flex-col gap-4">
      <Wordmark />
      <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">
        Verifying {apex}
      </h1>
      <p className="m-0 text-sm text-muted-foreground">
        Step 3 of 3 — point DNS at this server, then issue an HTTPS certificate.
      </p>

      <DnsRecordCard apex={apex} expectedIp={expectedIp} />

      <StatusRow
        label="Apex DNS"
        state={
          status.expectedIp !== null && status.observedIps.includes(status.expectedIp)
            ? 'ok'
            : 'pending'
        }
        detail={
          status.expectedIp !== null && status.observedIps.includes(status.expectedIp)
            ? `${apex} resolves to ${expectedIp}`
            : status.observedIps.length === 0
              ? `Waiting for propagation of @ → ${expectedIp}`
              : `${apex} resolves to ${status.observedIps.join(', ')} — expected ${expectedIp}`
        }
      />

      <StatusRow
        label="Wildcard DNS"
        state={status.wildcardResolved ? 'ok' : 'pending'}
        detail={
          status.wildcardResolved
            ? `*.${apex} resolves to ${expectedIp}`
            : status.wildcardObservedIps.length === 0
              ? `Waiting for propagation of * → ${expectedIp} (required so every instance subdomain is reachable)`
              : `*.${apex} resolves to ${status.wildcardObservedIps.join(', ')} — expected ${expectedIp}`
        }
      />

      <StatusRow
        label="HTTPS"
        state={httpsState}
        detail={
          !status.dnsResolved
            ? 'Waiting for DNS first…'
            : status.cert?.issued
              ? `Issued by ${status.cert.issuer ?? 'a CA'} (valid until ${status.cert.notAfter ?? '—'})`
              : status.cert?.selfSigned
                ? `Caddy served a self-signed fallback — issuance hasn't happened yet.`
                : status.cert?.error
                  ? status.cert.error
                  : 'Click "Complete setup" to trigger Let\'s Encrypt.'
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={refreshing || issuing} onClick={() => void onRecheck()}>
          {refreshing ? 'Rechecking…' : 'Recheck DNS now'}
        </Button>
        <Button
          disabled={!status.dnsResolved || issuing}
          onClick={() => void onIssue()}
          className="flex-1"
        >
          {issuing ? (
            <>
              <Loader2 className="size-3.5 animate-spin" /> Issuing cert… (~10s)
            </>
          ) : (
            'Complete setup'
          )}
        </Button>
      </div>

      <button
        type="button"
        onClick={onChangeDomain}
        className="self-start bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground"
      >
        ← Change apex domain
      </button>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function DnsRecordCard({
  apex,
  expectedIp,
}: {
  apex: string;
  expectedIp: string;
}): React.ReactElement {
  const apexHost = apex.split('.').length > 2 ? (apex.split('.')[0] ?? '@') : '@';
  const wildcardHost = apex.split('.').length > 2 ? `*.${apex.split('.')[0]}` : '*';
  return (
    <div className="rounded-md border border-border bg-card p-3.5 text-sm text-foreground-light">
      <div className="mb-3 text-foreground">
        Add <strong>both</strong> A records at your DNS registrar:
      </div>
      <table className="w-full border-collapse font-mono text-sm">
        <tbody>
          <DnsRow label="Type" value="A" />
          <DnsRow
            label="Host"
            value={apexHost}
            hint={apexHost === '@' ? '(or the apex itself — routes the dashboard)' : '(routes the dashboard)'}
          />
          <DnsRow label="Value" value={expectedIp} copyable />
          <DnsRow label="TTL" value="60–300 seconds" />
        </tbody>
      </table>
      <div className="my-3 border-t border-border-soft" />
      <table className="w-full border-collapse font-mono text-sm">
        <tbody>
          <DnsRow label="Type" value="A" />
          <DnsRow
            label="Host"
            value={wildcardHost}
            hint={'(routes every per-instance subdomain)'}
          />
          <DnsRow label="Value" value={expectedIp} copyable />
          <DnsRow label="TTL" value="60–300 seconds" />
        </tbody>
      </table>
    </div>
  );
}

function DnsRow({
  label,
  value,
  hint,
  copyable,
}: {
  label: string;
  value: string;
  hint?: string;
  copyable?: boolean;
}): React.ReactElement {
  return (
    <tr>
      <td className="w-16 py-1 pr-3 text-muted-foreground">{label}</td>
      <td className="py-1 text-foreground">
        {value}
        {hint && <span className="ml-2 text-muted-foreground">{hint}</span>}
        {copyable && (
          <CopyButton value={value} variant="ghost" size="xs" className="ml-2" />
        )}
      </td>
    </tr>
  );
}

function StatusRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: 'ok' | 'pending' | 'waiting' | 'error';
  detail: string;
}): React.ReactElement {
  const Icon =
    state === 'ok' ? CheckCircle2 : state === 'error' ? AlertTriangle : state === 'waiting' ? Circle : Loader2;
  const iconClass =
    state === 'ok'
      ? 'text-success'
      : state === 'error'
        ? 'text-destructive'
        : state === 'waiting'
          ? 'text-muted-foreground'
          : 'text-warn animate-spin';
  return (
    <div className="flex items-start gap-3 border-t border-border-soft py-2">
      <Icon className={`mt-0.5 size-[18px] flex-none ${iconClass}`} />
      <div className="flex-1">
        <div className="text-sm text-foreground">{label}</div>
        <div className="mt-0.5 text-sm text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

function Wordmark(): React.ReactElement {
  return (
    <div className="mb-2 flex items-center gap-2.5">
      <span aria-hidden className="inline-block size-7 rounded-md bg-success" />
      <span className="text-base font-medium">Selfbase</span>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <div>
      <Label className="mb-1.5 block text-sm text-foreground-light">{label}</Label>
      {children}
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
