import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Circle, Loader2, AlertTriangle, AlertCircle } from 'lucide-react';
import {
  apexApi,
  authApi,
  orgApi,
  setupApi,
  wildcardCertApi,
  type ChallengeRecord,
  type DnsCheck,
} from '@/lib/api';
import { getWrapperSnippet, getSelfbaseFileContent } from '@/lib/cli-wrapper';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CopyButton } from '@/components/CopyButton';

type Step = 'loading' | 'admin' | 'domain-certs' | 'cli-onboard';

const masterTokenRef: { current: string | null } = { current: null };
const apexRef: { current: string } = { current: '' };

export function SetupPage(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
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
        const apexStatus = await apexApi.status();
        if (cancelled) return;
        if (!apexStatus.apex) {
          setStep('domain-certs');
        } else if (apexStatus.cert?.issued) {
          apexRef.current = apexStatus.apex;
          if (searchParams.get('step') === '4') {
            setStep('cli-onboard');
          } else {
            navigate('/', { replace: true });
            return;
          }
        } else {
          apexRef.current = apexStatus.apex ?? '';
          setStep('domain-certs');
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
  }, [bootstrapped, navigate, searchParams]);

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
          onCreated={async () => {
            await refresh();
            setStep('domain-certs');
          }}
          setMasterToken={(t) => {
            masterTokenRef.current = t;
          }}
        />
      )}
      {step === 'domain-certs' && (
        <DomainCertsStep
          initialApex={apexRef.current}
          onDone={(apex) => {
            apexRef.current = apex;
            setStep('cli-onboard');
          }}
        />
      )}
      {step === 'cli-onboard' && (
        <CliOnboardingStep masterToken={masterTokenRef.current} apex={apexRef.current} />
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
      <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">First-time setup</h1>
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

// ─── Step 2: domain + certs (merged) ───────────────────────────────────────

type DomainCertsSub =
  | 'enter-apex'
  | 'verifying-dns'
  | 'issuing-certs'
  | 'verifying-https'
  | 'done';

function DomainCertsStep({
  initialApex,
  onDone,
}: {
  initialApex: string;
  onDone: (apex: string) => void;
}): React.ReactElement {
  const [sub, setSub] = useState<DomainCertsSub>(initialApex ? 'verifying-dns' : 'enter-apex');
  const [apexInput, setApexInput] = useState(initialApex);
  const [apex, setApex] = useState(initialApex);
  const [challengeRecords, setChallengeRecords] = useState<ChallengeRecord[]>([]);
  const [dnsChecks, setDnsChecks] = useState<DnsCheck[]>([]);
  const [apexDnsOk, setApexDnsOk] = useState(false);
  const [wildcardDnsOk, setWildcardDnsOk] = useState(false);
  const [allTxtReady, setAllTxtReady] = useState(false);
  const [expectedIp, setExpectedIp] = useState('');
  const [recheckLoading, setRecheckLoading] = useState(false);
  const [issuingError, setIssuingError] = useState<string | null>(null);
  const [httpsCheckRetries, setHttpsCheckRetries] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);

  const allTxtFound =
    challengeRecords.length >= 2 &&
    challengeRecords.every((rec) => dnsChecks.find((c) => c.value === rec.value)?.found === true);
  const allDnsResolved = apexDnsOk && wildcardDnsOk && allTxtFound;

  const saveApex = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSaveError(null);
    try {
      await orgApi.patch({ apexDomain: apexInput.trim() });
      setApex(apexInput.trim());
      const initiated = await wildcardCertApi.initiate();
      setChallengeRecords(initiated.challengeRecords);
      setSub('verifying-dns');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setSaveError(e.response?.data?.error?.message ?? e.message ?? 'save failed');
    }
  };

  // Poll DNS every 10s while in verifying-dns state
  useEffect(() => {
    if (sub !== 'verifying-dns') return;
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const [apexStatus, wcStatus] = await Promise.all([
          apexApi.status(),
          wildcardCertApi.status(),
        ]);
        if (cancelled) return;
        setExpectedIp(apexStatus.expectedIp ?? '');
        setApexDnsOk(apexStatus.dnsResolved);
        setWildcardDnsOk(apexStatus.wildcardResolved);
        setDnsChecks(wcStatus.cert?.dnsChecks ?? []);
        setAllTxtReady(wcStatus.cert?.allDnsReady ?? false);
        if (!challengeRecords.length && wcStatus.cert?.challengeRecords?.length) {
          setChallengeRecords(wcStatus.cert.challengeRecords);
        }
      } catch {
        /* keep existing state on poll error */
      }
    };

    void poll();
    const id = setInterval(() => void poll(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sub, challengeRecords.length]);

  const onRecheck = async (): Promise<void> => {
    setRecheckLoading(true);
    try {
      await apexApi.recheck();
      const [apexStatus, wcStatus] = await Promise.all([
        apexApi.status(),
        wildcardCertApi.status(),
      ]);
      setExpectedIp(apexStatus.expectedIp ?? '');
      setApexDnsOk(apexStatus.dnsResolved);
      setWildcardDnsOk(apexStatus.wildcardResolved);
      setDnsChecks(wcStatus.cert?.dnsChecks ?? []);
      setAllTxtReady(wcStatus.cert?.allDnsReady ?? false);
    } finally {
      setRecheckLoading(false);
    }
  };

  const onCreateCerts = async (): Promise<void> => {
    setIssuingError(null);
    setSub('issuing-certs');
    try {
      await Promise.all([apexApi.issue(), wildcardCertApi.verify()]);
      setSub('verifying-https');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } }; message?: string };
      setIssuingError(e.response?.data?.error?.message ?? e.message ?? 'cert issuance failed');
      setSub('verifying-dns');
    }
  };

  // After cert issuance, poll httpsReachable
  useEffect(() => {
    if (sub !== 'verifying-https') return;
    let cancelled = false;
    let attempts = 0;
    const check = async (): Promise<void> => {
      try {
        const status = await apexApi.status();
        if (cancelled) return;
        if (status.httpsReachable) {
          setSub('done');
          return;
        }
      } catch {
        /* retry */
      }
      attempts++;
      setHttpsCheckRetries(attempts);
      if (attempts < 6 && !cancelled) {
        setTimeout(() => void check(), 5_000);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [sub]);

  const onFinishSetup = (): void => {
    if (window.location.hostname === apex) {
      window.location.href = `/setup?step=4`;
    } else {
      window.location.href = `https://${apex}/setup?step=4`;
    }
    onDone(apex);
  };

  const apexHost = apex.split('.').length > 2 ? (apex.split('.')[0] ?? '@') : '@';
  const wildcardHost = apex.split('.').length > 2 ? `*.${apex.split('.')[0]}` : '*';

  if (sub === 'enter-apex') {
    return (
      <form onSubmit={(e) => void saveApex(e)} className="flex w-96 max-w-full flex-col gap-4">
        <Wordmark />
        <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">
          Connect your domain
        </h1>
        <p className="m-0 text-sm text-muted-foreground">
          Step 2 of 3 — your Selfbase dashboard and instance subdomains will live under this apex.
          Pick something you control DNS for, like <code>selfbase.example.com</code>.
        </p>
        <Field label="Apex domain">
          <Input
            required
            value={apexInput}
            onChange={(e) => setApexInput(e.target.value)}
            placeholder="selfbase.example.com"
            autoFocus
          />
        </Field>
        {saveError && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>{saveError}</AlertDescription>
          </Alert>
        )}
        <Button type="submit">Save & continue</Button>
      </form>
    );
  }

  if (sub === 'done') {
    return (
      <div className="flex w-[30rem] max-w-full flex-col gap-4">
        <Wordmark />
        <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">
          Domain & certificates ready
        </h1>
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-4 text-sm text-success">
          <CheckCircle2 className="size-5 flex-none" />
          <span>Certs issued and verified ✓</span>
        </div>
        <p className="m-0 text-sm text-muted-foreground">
          <code>{apex}</code> is live with HTTPS. Next: set up your local CLI.
        </p>
        <Button onClick={onFinishSetup} className="w-full">
          Finish Setup →
        </Button>
      </div>
    );
  }

  if (sub === 'issuing-certs') {
    return (
      <div className="flex w-[30rem] max-w-full flex-col gap-4">
        <Wordmark />
        <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">
          Issuing certificates…
        </h1>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>Requesting Let&apos;s Encrypt certificates for {apex}… (~30s)</span>
        </div>
      </div>
    );
  }

  if (sub === 'verifying-https') {
    return (
      <div className="flex w-[30rem] max-w-full flex-col gap-4">
        <Wordmark />
        <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">
          Verifying HTTPS…
        </h1>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span>
            Checking that {apex} is reachable over HTTPS
            {httpsCheckRetries > 0 ? ` (attempt ${httpsCheckRetries + 1}/6)` : ''}…
          </span>
        </div>
        {httpsCheckRetries >= 6 && (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertDescription>
              HTTPS not yet reachable — DNS propagation can take a few minutes. Try again.
            </AlertDescription>
          </Alert>
        )}
        {httpsCheckRetries >= 6 && (
          <Button onClick={() => { setHttpsCheckRetries(0); setSub('verifying-https'); }}>
            Retry HTTPS check
          </Button>
        )}
      </div>
    );
  }

  // verifying-dns sub-state
  return (
    <div className="flex w-[32rem] max-w-full flex-col gap-4">
      <Wordmark />
      <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">
        Set up DNS for {apex}
      </h1>
      <p className="m-0 text-sm text-muted-foreground">
        Step 2 of 3 — add all 4 records at your DNS registrar. A records route traffic; TXT records
        prove domain ownership for the wildcard certificate.
      </p>

      {issuingError && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{issuingError}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-md border border-border bg-card text-sm">
        <div className="border-b border-border px-3.5 py-2.5 font-medium text-foreground">
          DNS records to add
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-xs text-muted-foreground">
              <th className="px-3.5 py-2 text-left font-normal">Type</th>
              <th className="px-3.5 py-2 text-left font-normal">Host</th>
              <th className="px-3.5 py-2 text-left font-normal">Value</th>
              <th className="px-3.5 py-2 text-left font-normal w-8">Status</th>
            </tr>
          </thead>
          <tbody>
            <DnsRecordRow
              type="A"
              host={apexHost}
              hint="dashboard"
              value={expectedIp || '…'}
              copyable
              resolved={apexDnsOk}
            />
            <DnsRecordRow
              type="A"
              host={wildcardHost}
              hint="instances"
              value={expectedIp || '…'}
              copyable
              resolved={wildcardDnsOk}
            />
            {challengeRecords.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3.5 py-2 text-muted-foreground text-xs">
                  <Loader2 className="inline size-3 animate-spin mr-1" />
                  Loading ACME challenge records…
                </td>
              </tr>
            ) : (
              challengeRecords.map((rec, i) => {
                const check = dnsChecks.find((c) => c.value === rec.value);
                return (
                  <DnsRecordRow
                    key={i}
                    type="TXT"
                    host="_acme-challenge"
                    hint={`wildcard cert #${i + 1}`}
                    value={rec.value}
                    copyable
                    resolved={check?.found ?? false}
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          disabled={recheckLoading}
          onClick={() => void onRecheck()}
          size="sm"
        >
          {recheckLoading ? <Loader2 className="size-3.5 animate-spin" /> : 'Recheck now'}
        </Button>
        <Button
          disabled={!allDnsResolved}
          onClick={() => void onCreateCerts()}
          className="flex-1"
        >
          {allDnsResolved ? 'Create Certs' : 'Waiting for DNS…'}
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setSub('enter-apex')}
        className="self-start bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground"
      >
        ← Change apex domain
      </button>
    </div>
  );
}

// ─── Step 3 (CLI onboarding) — shown on new domain via ?step=4 ─────────────

function CliOnboardingStep({
  masterToken,
  apex,
}: {
  masterToken: string | null;
  apex: string;
}): React.ReactElement {
  const selfbaseContent = getSelfbaseFileContent(masterToken ?? '<your-api-token>', apex);
  const wrapperCode = getWrapperSnippet(apex);

  return (
    <div className="flex w-[32rem] max-w-full flex-col gap-6">
      <Wordmark />
      <div>
        <h1 className="m-0 text-3xl font-normal tracking-tight text-foreground">CLI setup</h1>
        <p className="m-0 mt-1 text-sm text-muted-foreground">
          Step 3 of 3 — configure your local <code>supabase</code> CLI to work with this
          Selfbase install.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-sm font-medium text-foreground">
          1. Create a <code>.selfbase</code> file in your project root
        </h2>
        <p className="m-0 text-sm text-muted-foreground">
          This file tells the CLI which Selfbase install to use and authenticates your requests.
          {!masterToken && (
            <span className="text-warn">
              {' '}Token not available — retrieve it from{' '}
              <a href="/settings/tokens" className="underline">
                Settings → API Tokens
              </a>
              .
            </span>
          )}
        </p>
        <div className="relative">
          <pre className="m-0 overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 pr-12 font-mono text-xs leading-relaxed text-foreground">
            <code>{selfbaseContent}</code>
          </pre>
          <CopyButton
            value={selfbaseContent}
            label="Copy"
            variant="ghost"
            size="xs"
            className="absolute right-1.5 top-1.5"
          />
        </div>
        <p className="m-0 text-xs text-muted-foreground">
          Add <code>.selfbase</code> to your <code>.gitignore</code> — it contains your API token.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="m-0 text-sm font-medium text-foreground">
          2. Add the shell wrapper to <code>~/.zshrc</code> or <code>~/.bashrc</code>
        </h2>
        <p className="m-0 text-sm text-muted-foreground">
          This wrapper automatically routes <code>supabase</code> CLI commands to the right
          Selfbase install based on the <code>.selfbase</code> file in your project.
        </p>
        <div className="relative">
          <pre className="m-0 max-h-48 overflow-y-auto overflow-x-auto rounded-md border border-border bg-secondary/40 p-3 pr-12 font-mono text-xs leading-relaxed text-foreground">
            <code>{wrapperCode}</code>
          </pre>
          <CopyButton
            value={wrapperCode}
            label="Copy"
            variant="ghost"
            size="xs"
            className="absolute right-1.5 top-1.5"
          />
        </div>
        <p className="m-0 text-xs text-muted-foreground">
          After adding, run <code>source ~/.zshrc</code> to activate it.
        </p>
      </div>

      <Button
        className="w-full"
        onClick={() => {
          window.location.href = `https://${apex}/dashboard`;
        }}
      >
        Done → Go to Dashboard
      </Button>
    </div>
  );
}

// ─── Shared subcomponents ───────────────────────────────────────────────────

function DnsRecordRow({
  type,
  host,
  hint,
  value,
  copyable,
  resolved,
}: {
  type: string;
  host: string;
  hint: string;
  value: string;
  copyable?: boolean;
  resolved: boolean;
}): React.ReactElement {
  return (
    <tr className="border-t border-border-soft">
      <td className="px-3.5 py-2 font-mono text-xs text-muted-foreground">{type}</td>
      <td className="px-3.5 py-2 font-mono text-xs">
        {host}
        <span className="ml-1.5 text-muted-foreground not-mono text-[11px]">({hint})</span>
      </td>
      <td className="px-3.5 py-2 font-mono text-xs max-w-[12rem] truncate">
        {value}
        {copyable && value !== '…' && (
          <CopyButton value={value} variant="ghost" size="xs" className="ml-1" />
        )}
      </td>
      <td className="px-3.5 py-2">
        {resolved ? (
          <CheckCircle2 className="size-4 text-success" />
        ) : (
          <Circle className="size-4 text-muted-foreground" />
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
    state === 'ok'
      ? CheckCircle2
      : state === 'error'
        ? AlertTriangle
        : state === 'waiting'
          ? Circle
          : Loader2;
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

// Silence unused import warning — StatusRow is available for future use
void StatusRow;
