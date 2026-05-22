import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * navigator.clipboard.writeText() requires a secure context (HTTPS or
 * localhost). On bare-IP HTTP installs it silently fails. Fall back to
 * the legacy execCommand('copy') path with a hidden textarea so copying
 * works for operators driving setup before TLS is configured.
 */
async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to legacy path */
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

export function CopyButton({
  value,
  label = 'Copy',
  variant = 'secondary',
  size = 'sm',
  className,
  iconOnly = false,
}: {
  value: string;
  label?: string;
  variant?: 'default' | 'secondary' | 'outline' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'xs' | 'icon' | 'icon-sm';
  className?: string;
  iconOnly?: boolean;
}): React.ReactElement {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  return (
    <Button
      type="button"
      variant={variant}
      size={iconOnly ? 'icon-sm' : size}
      className={cn(className)}
      onClick={async () => {
        const ok = await copyToClipboard(value);
        setState(ok ? 'ok' : 'fail');
        window.setTimeout(() => setState('idle'), 1500);
      }}
    >
      {state === 'ok' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {!iconOnly && (state === 'ok' ? 'Copied' : state === 'fail' ? 'Failed' : label)}
    </Button>
  );
}
