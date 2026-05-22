import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { instancesApi } from '@/lib/api';
import { ProjectShell } from '@/components/ProjectShell';
import { CardRow } from '@/components/CardRow';
import { InputWithCopy, FrameButton } from '@/components/InputWithCopy';
import { RevealDialog } from '@/components/RevealDialog';
import { useRevealCredentials } from '@/lib/use-reveal-credentials';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface InstanceMeta {
  ref: string;
  name: string;
  status: string;
  createJwtExpirySec?: number;
}

export function ProjectJwtKeysPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const navigate = useNavigate();
  const reveal = useRevealCredentials(ref);

  const { data } = useQuery<InstanceMeta>({
    queryKey: ['instances', ref, 'jwt-meta'],
    queryFn: () => instancesApi.get(ref) as Promise<InstanceMeta>,
  });

  return (
    <ProjectShell
      title="JWT Keys"
      subtitle="Control the keys used to sign JSON Web Tokens for your project."
    >
      <div>
        <h2 className="m-0 mb-3 text-lg font-medium text-foreground">Legacy JWT Secret</h2>

        <Card>
          {/* Top alert banner */}
          <div className="px-6 py-5">
            <div className="flex items-start gap-3 rounded-md border border-warn/40 bg-warn/5 p-4">
              <span className="flex size-7 flex-none items-center justify-center rounded-md bg-warn/15 text-warn">
                <AlertTriangle className="size-4" />
              </span>
              <div className="flex flex-col gap-1.5">
                <div className="text-sm font-medium text-foreground">
                  Legacy JWT secret is the active signing key
                </div>
                <p className="m-0 text-sm leading-relaxed text-muted-foreground">
                  Used to <span className="text-foreground">sign and verify</span> JSON Web
                  Tokens for this project. This includes the{' '}
                  <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">
                    anon
                  </code>{' '}
                  and{' '}
                  <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">
                    service_role
                  </code>{' '}
                  JWT-based API keys. Treat it like a password — if leaked, every JWT issued
                  by this project must be considered compromised.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 self-start"
                  onClick={() => navigate(`/p/${ref}/api-keys`)}
                >
                  <ExternalLink className="size-3.5" />
                  Go to API keys
                </Button>
              </div>
            </div>
          </div>

          <CardRow label="Legacy JWT secret (still used)" hint="Used to verify JWTs.">
            <JwtSecretInput
              value={reveal.creds?.jwtSecret ?? null}
              onReveal={reveal.openDialog}
            />
          </CardRow>

          <CardRow
            label="Access token expiry time"
            hint={
              <>
                How long access tokens are valid for before a refresh token has to be used.
                <br />
                Recommendation: 3600 (1 hour).
              </>
            }
          >
            <div className="flex h-9 items-stretch overflow-hidden rounded-md border border-border bg-input">
              <input
                value={data?.createJwtExpirySec ?? 3600}
                readOnly
                className="min-w-0 flex-1 bg-transparent px-3 text-sm text-muted-foreground outline-none"
              />
              <span className="inline-flex items-center border-l border-border bg-card px-3 text-xs text-muted-foreground">
                seconds
              </span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Set at project creation. Changing this currently requires re-provisioning the
              project.
            </p>
          </CardRow>
        </Card>
      </div>

      <RevealDialog
        open={reveal.dialogOpen}
        onOpenChange={(o) => (o ? reveal.openDialog() : reveal.closeDialog())}
        password={reveal.password}
        onPasswordChange={reveal.setPassword}
        onSubmit={() => void reveal.reveal()}
        error={reveal.error}
        pending={reveal.pending}
      />
    </ProjectShell>
  );
}

function JwtSecretInput({
  value,
  onReveal,
}: {
  value: string | null;
  onReveal: () => void;
}): React.ReactElement {
  const [shown, setShown] = useState(false);
  const masked = '•'.repeat(40);
  const displayValue = !value ? masked : shown ? value : masked;

  return (
    <InputWithCopy
      mono
      readOnly
      value={displayValue}
      copyValue={value ?? ''}
      noCopy={!value}
      rightSlot={
        !value ? (
          <FrameButton onClick={onReveal}>Reveal</FrameButton>
        ) : (
          <FrameButton
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Hide' : 'Show'}
            title={shown ? 'Hide' : 'Show'}
          >
            {shown ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
          </FrameButton>
        )
      }
    />
  );
}
