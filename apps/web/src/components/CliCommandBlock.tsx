import { CopyButton } from '@/components/CopyButton';
import { cn } from '@/lib/utils';

/**
 * A boxed shell command with an inline copy button. Used by the
 * Connect-CLI page (and any future page that surfaces commands a user
 * is meant to paste into a terminal).
 *
 * Style mirrors the Supabase dashboard's command blocks: monospace
 * body, dim border, prompt-prefix on the left, copy button pinned right.
 */
export function CliCommandBlock({
  command,
  caption,
  prompt = '$',
  className,
}: {
  command: string;
  caption?: React.ReactNode;
  prompt?: string;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="group flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 font-mono text-xs leading-relaxed text-foreground">
        <span className="select-none text-muted-foreground">{prompt}</span>
        <pre className="m-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all bg-transparent p-0 text-xs">
          {command}
        </pre>
        <CopyButton value={command} variant="ghost" size="icon-sm" iconOnly />
      </div>
      {caption && <div className="px-1 text-xs text-muted-foreground">{caption}</div>}
    </div>
  );
}
