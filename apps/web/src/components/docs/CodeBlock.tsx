import { CopyButton } from '@/components/CopyButton';

/** A scrollable code/config block with a one-click copy. Feature 116 (US1). */
export function CodeBlock({ code }: { code: string }): React.ReactElement {
  return (
    <div className="relative my-3 rounded-md border border-default bg-surface-200">
      <div className="absolute right-2 top-2 z-10">
        <CopyButton value={code} iconOnly />
      </div>
      <pre className="overflow-x-auto p-3 pr-12 text-xs leading-relaxed text-foreground-light">
        <code>{code}</code>
      </pre>
    </div>
  );
}
