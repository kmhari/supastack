import { cn } from '@/lib/utils';

/** Shared admin display bits. Feature 116. */

export function PageHeader({ title, sub }: { title: string; sub?: string }): React.ReactElement {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {sub && <p className="mt-1 text-sm text-foreground-light">{sub}</p>}
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  running: 'bg-brand/15 text-brand-600',
  healthy: 'bg-brand/15 text-brand-600',
  ACTIVE_HEALTHY: 'bg-brand/15 text-brand-600',
  success: 'bg-brand/15 text-brand-600',
  issued: 'bg-brand/15 text-brand-600',
  paused: 'bg-surface-300 text-foreground-light',
  restoring: 'bg-surface-300 text-foreground-light',
  unhealthy: 'bg-destructive-200 text-destructive-600',
  failed: 'bg-destructive-200 text-destructive-600',
  error: 'bg-destructive-200 text-destructive-600',
};

export function StatusBadge({ status }: { status: string | null | undefined }): React.ReactElement {
  const s = status ?? 'unknown';
  return (
    <span
      className={cn(
        'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
        STATUS_TONE[s] ?? 'bg-surface-300 text-foreground-light',
      )}
    >
      {s}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rounded-md border border-default bg-surface-100 p-6 text-sm text-foreground-light">
      {children}
    </div>
  );
}

export function Th({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-foreground-lighter">
      {children}
    </th>
  );
}
export function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return <td className={cn('px-3 py-2 align-middle', className)}>{children}</td>;
}
