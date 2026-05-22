import { Badge } from '@/components/ui/badge';

type Status =
  | 'running'
  | 'provisioning'
  | 'paused'
  | 'stopped'
  | 'failed'
  | 'deleting'
  | 'completed';

const variantFor: Record<Status, 'success' | 'warn' | 'info' | 'outline' | 'destructive'> = {
  running: 'success',
  completed: 'success',
  provisioning: 'warn',
  paused: 'info',
  stopped: 'outline',
  deleting: 'outline',
  failed: 'destructive',
};

export function StatusPill({ status }: { status: string }): React.ReactElement {
  const variant = (variantFor[status as Status] ?? 'outline') as
    | 'success'
    | 'warn'
    | 'info'
    | 'outline'
    | 'destructive';
  return <Badge variant={variant}>{status}</Badge>;
}
