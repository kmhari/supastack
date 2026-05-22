import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Eye, EyeOff } from 'lucide-react';
import { ProjectShell } from '@/components/ProjectShell';
import { CopyButton } from '@/components/CopyButton';
import { RevealDialog } from '@/components/RevealDialog';
import { useRevealCredentials } from '@/lib/use-reveal-credentials';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function ProjectApiKeysPage(): React.ReactElement {
  const { ref = '' } = useParams<{ ref: string }>();
  const reveal = useRevealCredentials(ref);

  return (
    <ProjectShell
      title="API Keys"
      subtitle="Configure API keys to securely control access to your project."
    >
      <Card>
        <CardHeader>
          <CardTitle>Legacy anon, service_role API keys</CardTitle>
          <CardDescription>
            JWTs signed with this project&apos;s JWT secret. Send as the <code>apikey</code> header
            (and as a Bearer token) on every request to <code>/rest/v1</code>, <code>/auth/v1</code>,
            <code>/realtime/v1</code>, <code>/storage/v1</code>, <code>/functions/v1</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <KeyRow
            name="anon"
            badgeText="public"
            badgeVariant="info"
            description="Safe to use in a browser if you've enabled Row Level Security for your tables and configured policies."
            value={reveal.creds?.anonKey ?? null}
            isSecret={false}
            onReveal={reveal.openDialog}
          />
          <KeyRow
            name="service_role"
            badgeText="secret"
            badgeVariant="destructive"
            description="Bypasses Row Level Security. Never share it publicly. If leaked, rotate the JWT secret immediately."
            value={reveal.creds?.serviceRoleKey ?? null}
            isSecret
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
  badgeVariant: 'info' | 'destructive';
  description: string;
  value: string | null;
  isSecret: boolean;
  onReveal: () => void;
}): React.ReactElement {
  const [shown, setShown] = useState(!isSecret);
  const masked = '•'.repeat(40);

  return (
    <div className="border-t border-border-soft first:border-t-0 p-6">
      <div className="mb-3 flex items-center gap-2.5">
        <code className="font-mono text-sm font-medium text-foreground">{name}</code>
        <Badge variant={badgeVariant}>{badgeText}</Badge>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{description}</p>

      {!value ? (
        <Button onClick={onReveal}>{isSecret ? 'Reveal' : 'Show'}</Button>
      ) : (
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md border border-border-soft bg-background px-3 py-2 font-mono text-xs text-foreground">
            {shown ? value : masked}
          </code>
          {isSecret && (
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
          )}
          <CopyButton value={value} variant="outline" />
        </div>
      )}
    </div>
  );
}
