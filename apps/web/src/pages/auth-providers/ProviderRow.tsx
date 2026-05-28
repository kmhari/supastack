import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  ActiveOAuthProvider,
  ToggleOnlyProvider,
  ComingSoonProvider,
} from './provider-registry';
import { ProviderIcon } from './ProviderIcon';

/**
 * Shared row geometry — used inside the providers Card so every row
 * shares borders / padding / separators (no individual bordered chips).
 */
const ROW_BASE = 'flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors';
const ROW_HOVER =
  'hover:bg-accent/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function ProviderRow({
  provider,
  enabled,
  onClick,
}: {
  provider: ActiveOAuthProvider;
  enabled: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button type="button" onClick={onClick} className={cn(ROW_BASE, ROW_HOVER)}>
      <ProviderIcon name={provider.key} />
      <div className="flex-1 text-sm">{provider.displayName}</div>
      <StatusBadge enabled={enabled} />
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}

export function EmailPhoneToggleRow({
  provider,
  enabled,
  onToggle,
  disabled,
}: {
  provider: ToggleOnlyProvider;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => !disabled && onToggle(!enabled)}
      disabled={disabled}
      className={cn(ROW_BASE, ROW_HOVER, disabled && 'cursor-not-allowed opacity-70')}
      aria-pressed={enabled}
      aria-label={`Toggle ${provider.displayName}`}
    >
      <ProviderIcon name={provider.key} />
      <div className="flex-1 text-sm">{provider.displayName}</div>
      <StatusBadge enabled={enabled} />
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  );
}

export function ComingSoonRow({ provider }: { provider: ComingSoonProvider }): React.ReactElement {
  const issueUrl = `https://github.com/kmhari/selfbase/issues/${provider.comingSoonIssue}`;
  return (
    <a
      href={issueUrl}
      target="_blank"
      rel="noreferrer"
      aria-disabled="true"
      className={cn(ROW_BASE, 'no-underline opacity-60 hover:opacity-100')}
      title={`Tracked in issue #${provider.comingSoonIssue}`}
    >
      <ProviderIcon name={provider.key} />
      <div className="flex-1 text-sm">{provider.displayName}</div>
      <span className="inline-flex items-center rounded-full border border-info/40 bg-info/10 px-2.5 py-0.5 text-xs font-medium text-info">
        Coming soon
      </span>
      <ChevronRight className="size-4 text-muted-foreground" />
    </a>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }): React.ReactElement {
  if (enabled) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/40 py-1 pr-3 pl-1 text-sm font-medium text-emerald-400">
        <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500">
          <Check className="size-3.5 text-emerald-950" strokeWidth={3} />
        </span>
        Enabled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-transparent px-3 py-1 text-sm font-medium text-muted-foreground">
      Disabled
    </span>
  );
}
