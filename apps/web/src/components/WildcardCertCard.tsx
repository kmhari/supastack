import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { InputWithCopy } from '@/components/InputWithCopy';
import type { ChallengeRecord, DnsCheck } from '@/lib/api';

interface Props {
  apex: string;
  challengeRecords: ChallengeRecord[];
  dnsChecks: DnsCheck[];
  allDnsReady: boolean;
  issuing: boolean;
  error: string | null;
  onIssue: () => void;
  onSkip: () => void;
}

export function WildcardCertCard({
  apex,
  challengeRecords,
  dnsChecks,
  allDnsReady,
  issuing,
  error,
  onIssue,
  onSkip,
}: Props): React.ReactElement {
  return (
    <div className="flex w-[30rem] max-w-full flex-col gap-4">
      <div className="rounded-md border border-border bg-card p-4 text-sm">
        <div className="mb-3 font-medium text-foreground">
          Add a TXT record at your DNS registrar
        </div>
        <p className="mb-3 text-muted-foreground">
          Add <strong>both values</strong> below as a multi-value TXT record on the same hostname.
          Most registrars let you add the same host twice with different values.
        </p>

        {/* TXT hostname — same for both values */}
        <div className="mb-2">
          <div className="mb-1 text-xs text-muted-foreground uppercase tracking-wide">Host</div>
          <InputWithCopy
            value={`_acme-challenge.${apex}`}
            readOnly
            className="font-mono text-xs"
          />
        </div>

        {/* Two challenge values */}
        <div className="mb-1 mt-3 text-xs text-muted-foreground uppercase tracking-wide">
          Values (add both)
        </div>
        {challengeRecords.map((rec, i) => {
          const check = dnsChecks.find((c) => c.value === rec.value);
          const found = check?.found ?? false;
          return (
            <div key={i} className="mt-2 flex items-center gap-2">
              <div className="flex-1">
                <InputWithCopy
                  value={rec.value}
                  readOnly
                  className="font-mono text-xs"
                />
              </div>
              {found ? (
                <CheckCircle2 className="size-4 flex-none text-success" />
              ) : (
                <Loader2 className="size-4 flex-none animate-spin text-muted-foreground" />
              )}
            </div>
          );
        })}

        <div className="mt-3 text-xs text-muted-foreground">
          Suggested TTL: 60 seconds. The status icons update every 10 seconds automatically.
        </div>
      </div>

      {/* Per-record DNS status summary */}
      {dnsChecks.length > 0 && (
        <div className="rounded-md border border-border bg-card px-4 py-2 text-sm">
          {dnsChecks.map((c, i) => (
            <div key={i} className="flex items-center gap-2 py-1">
              {c.found ? (
                <CheckCircle2 className="size-4 text-success flex-none" />
              ) : (
                <Loader2 className="size-4 animate-spin text-muted-foreground flex-none" />
              )}
              <span className="text-muted-foreground">
                {c.found ? 'Value confirmed in DNS' : 'Waiting for propagation…'}
              </span>
              <code className="ml-auto font-mono text-xs text-foreground-light truncate max-w-[12rem]">
                {c.value.slice(0, 16)}…
              </code>
            </div>
          ))}
        </div>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button
        disabled={!allDnsReady || issuing}
        onClick={onIssue}
        className="w-full"
      >
        {issuing ? (
          <>
            <Loader2 className="size-3.5 animate-spin mr-2" />
            Issuing certificate… (~15s)
          </>
        ) : !allDnsReady ? (
          'Waiting for DNS propagation…'
        ) : (
          'Issue Certificate'
        )}
      </Button>

      <button
        type="button"
        onClick={onSkip}
        className="self-center bg-transparent p-0 text-sm text-muted-foreground hover:text-foreground"
      >
        Skip for now — use per-subdomain TLS
      </button>
    </div>
  );
}
