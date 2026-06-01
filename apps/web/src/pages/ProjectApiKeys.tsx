import { useParams } from 'react-router-dom';
import { ProjectShell } from '@/components/ProjectShell';
import { InputWithCopy, FrameButton } from '@/components/InputWithCopy';
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
            onReveal={() => void reveal.reveal()}
            pending={reveal.pending}
          />
          <KeyRow
            name="service_role"
            badgeText="secret"
            badgeVariant="destructive"
            description="This key has the ability to bypass Row Level Security. Never share it publicly. If leaked, generate a new JWT secret immediately."
            value={reveal.creds?.serviceRoleKey ?? null}
            onReveal={() => void reveal.reveal()}
            pending={reveal.pending}
          />
        </Card>
      </div>
    </ProjectShell>
  );
}

function KeyRow({
  name,
  badgeText,
  badgeVariant,
  description,
  value,
  onReveal,
  pending,
}: {
  name: string;
  badgeText: string;
  badgeVariant: 'outline' | 'destructive';
  description: string;
  value: string | null;
  onReveal: () => void;
  pending: boolean;
}): React.ReactElement {
  const masked = '•'.repeat(40);

  return (
    <div className="grid grid-cols-[220px_1fr] items-start gap-8 px-6 py-5">
      {/* Left column: name + badge */}
      <div className="flex items-center gap-2 pt-1.5">
        <code className="font-mono text-sm text-foreground">{name}</code>
        <Badge variant={badgeVariant}>{badgeText}</Badge>
      </div>

      {/* Right column: framed input + Reveal/Copy button, description below */}
      <div className="flex flex-col gap-3">
        <InputWithCopy
          mono
          readOnly
          value={value ?? masked}
          copyValue={value ?? ''}
          noCopy={!value}
          rightSlot={
            !value ? (
              <FrameButton onClick={onReveal} disabled={pending}>
                {pending ? 'Loading…' : 'Reveal'}
              </FrameButton>
            ) : undefined
          }
        />
        <p className="m-0 text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
