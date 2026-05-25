import { useState, forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Composite input that renders a Copy button INSIDE the same bordered
 * frame as the input, separated by a subtle vertical divider.
 *
 * Matches the Supabase project Settings input style:
 *   ┌──────────────────────────────┬──────────┐
 *   │ value                        │ ⧉ Copy   │
 *   └──────────────────────────────┴──────────┘
 *
 * Use this everywhere we previously had `<Input>` + `<CopyButton>`
 * sitting next to each other.
 */

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

interface InputWithCopyProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Value to copy. Defaults to the input's `value` prop. */
  copyValue?: string;
  /** Hide the right-side button entirely (renders as a plain framed input). */
  noCopy?: boolean;
  /** Additional content rendered BEFORE the default Copy button.
   *  Use `<FrameButton>` for consistent styling. Combine with `noCopy`
   *  to render ONLY this slot (e.g., a single Reveal button). */
  rightSlot?: ReactNode;
  /** Apply monospace font (good for IDs, keys, URLs). */
  mono?: boolean;
  /** Wrapper className. */
  className?: string;
}

/**
 * A button styled to sit inside the InputWithCopy frame. Use for
 * "Reveal", "Hide", or any other action that should look like the
 * default Copy button (left-bordered, bg-card, hover effect).
 */
export function FrameButton({
  children,
  onClick,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement>): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 border-l border-border bg-card px-3 text-xs text-foreground-light transition-colors hover:bg-secondary hover:text-foreground',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export const InputWithCopy = forwardRef<HTMLInputElement, InputWithCopyProps>(
  function InputWithCopy(
    { copyValue, noCopy, rightSlot, mono, className, value, readOnly, ...rest },
    ref,
  ) {
    const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
    const effectiveCopy =
      copyValue !== undefined ? copyValue : typeof value === 'string' ? value : '';

    const onCopy = async (): Promise<void> => {
      if (!effectiveCopy) return;
      const ok = await copyToClipboard(effectiveCopy);
      setState(ok ? 'ok' : 'fail');
      window.setTimeout(() => setState('idle'), 1500);
    };

    return (
      <div
        className={cn(
          'flex h-9 items-stretch overflow-hidden rounded-md border border-border bg-input transition-colors focus-within:border-foreground-light',
          className,
        )}
      >
        <input
          ref={ref}
          value={value}
          readOnly={readOnly}
          className={cn(
            'min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground',
            mono && 'font-mono',
          )}
          {...rest}
        />
        {rightSlot}
        {!noCopy && (
          <FrameButton onClick={() => void onCopy()} aria-label="Copy value">
            {state === 'ok' ? (
              <>
                <Check className="size-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-3" />
                {state === 'fail' ? 'Failed' : 'Copy'}
              </>
            )}
          </FrameButton>
        )}
      </div>
    );
  },
);
