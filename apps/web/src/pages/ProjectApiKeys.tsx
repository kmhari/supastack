import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { ProjectShell } from '@/components/ProjectShell';
import { InputWithCopy, FrameButton } from '@/components/InputWithCopy';
import { RevealDialog } from '@/components/RevealDialog';
import { useRevealCredentials } from '@/lib/use-reveal-credentials';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export function ProjectApiKeysPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const reveal = useRevealCredentials(ref);

  return (
    <ProjectShell
      title="API Keys"
      subtitle="Configure API keys to securely control access to your project."
    >
      <div>
        <h2 className="m-0 mb-3 text-lg font-medium text-foreground">
          Legacy anon, service_role API keys
        </h2>
        <Card>
          <KeyRow
            name="anon"
            badgeText="public"
            badgeVariant="outline"
            description="This key is safe to use in a browser if you have enabled Row Level Security for your tables and configured policies."
            value={reveal.creds?.anonKey ?? null}
            isSecret={false}
            onReveal={reveal.openDialog}
          />
          <KeyRow
            name="service_role"
            badgeText="secret"
            badgeVariant="destructive"
            description="This key has the ability to bypass Row Level Security. Never share it publicly. If leaked, generate a new JWT secret immediately."
            value={reveal.creds?.serviceRoleKey ?? null}
            isSecret
            onReveal={reveal.openDialog}
          />
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

function KeyRow({
  name,
  badgeText,
  badgeVariant,
  description,
  value,
  isSecret,
  onReveal,
}: {
  name: string;
  badgeText: string;
  badgeVariant: 'outline' | 'destructive';
  description: string;
  value: string | null;
  isSecret: boolean;
  onReveal: () => void;
}): React.ReactElement {
  const [shown, setShown] = useState(!isSecret);
  const masked = '•'.repeat(40);
  // For a public anon key we ALWAYS show the value (when loaded). For
  // service_role we mask until the user hits Reveal AND toggles Show.
  const displayValue = !value ? masked : isSecret ? (shown ? value : masked) : value;
  const isRevealed = value !== null;

  return (
    <div className="grid grid-cols-[220px_1fr] items-start gap-8 px-6 py-5">
      {/* Left column: name + badge */}
      <div className="flex items-center gap-2 pt-1.5">
        <code className="font-mono text-sm text-foreground">{name}</code>
        <Badge variant={badgeVariant}>{badgeText}</Badge>
      </div>

      {/* Right column: framed input + Reveal/Hide button, description below */}
      <div className="flex flex-col gap-3">
        <InputWithCopy
          mono
          readOnly
          value={displayValue}
          copyValue={value ?? ''}
          noCopy={!isRevealed}
          rightSlot={
            !isRevealed ? (
              <FrameButton onClick={onReveal}>Reveal</FrameButton>
            ) : isSecret ? (
              <FrameButton
                onClick={() => setShown((v) => !v)}
                aria-label={shown ? 'Hide' : 'Show'}
                title={shown ? 'Hide' : 'Show'}
              >
                {shown ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              </FrameButton>
            ) : undefined
          }
        />
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
