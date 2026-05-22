import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { ProjectShell } from '@/components/ProjectShell';
import { CopyButton } from '@/components/CopyButton';
import { RevealDialog } from '@/components/RevealDialog';
import { useRevealCredentials } from '@/lib/use-reveal-credentials';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ProjectJwtKeysPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const reveal = useRevealCredentials(ref);

  return (
    <ProjectShell
      title="JWT Keys"
      subtitle="Control the keys used to sign JSON Web Tokens for your project."
    >
      <Card>
        <CardHeader>
          <CardTitle>JWT Signing Keys</CardTitle>
          <CardDescription>
            Used to verify JSON Web Tokens issued by this project — including the{' '}
            <Link to={`/p/${ref}/api-keys`} className="text-success no-underline hover:underline">
              anon and service_role API keys
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <JwtRow
            label="Legacy JWT secret"
            description="40-byte random base64 string. Required to verify the anon and service_role JWTs that callers send in the apikey header. Treat it like a password — if leaked, every issued JWT must be considered compromised."
            value={reveal.creds?.jwtSecret ?? null}
            onReveal={reveal.openDialog}
          />
        </CardContent>
      </Card>

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

function JwtRow({
  label,
  description,
  value,
  onReveal,
}: {
  label: string;
  description: string;
  value: string | null;
  onReveal: () => void;
}): React.ReactElement {
  const [shown, setShown] = useState(false);
  const masked = '•'.repeat(40);
  return (
    <div>
      <div className="mb-1 text-sm font-medium text-foreground">{label}</div>
      <p className="mb-4 text-sm text-muted-foreground">{description}</p>
      {!value ? (
        <Button onClick={onReveal}>Reveal</Button>
      ) : (
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border border-border-soft bg-background px-3 py-2 font-mono text-xs text-foreground">
            {shown ? value : masked}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Hide' : 'Show'}
            title={shown ? 'Hide' : 'Show'}
          >
            {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
          <CopyButton value={value} variant="outline" />
        </div>
      )}
    </div>
  );
}
