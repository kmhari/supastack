import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Single bordered shell that visually contains an input and a trailing
 * action button (Copy, Reveal, etc.), matching Supabase Cloud's pattern
 * where the action sits flush inside the input's right edge.
 */
export function InputWithSuffix({
  className,
  children,
  suffix,
}: {
  className?: string;
  children: React.ReactNode;
  suffix?: React.ReactNode;
}): React.ReactElement {
  return (
    <div
      className={cn(
        'flex h-9 w-full items-center rounded-md border border-border bg-input text-sm shadow-xs transition-colors',
        'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50',
        className,
      )}
    >
      <div className="flex-1 [&>input]:h-full [&>input]:w-full [&>input]:border-0 [&>input]:bg-transparent [&>input]:px-3 [&>input]:py-1 [&>input]:shadow-none [&>input]:outline-none [&>input]:ring-0 [&>input:focus]:ring-0 [&>input:focus-visible]:ring-0">
        {children}
      </div>
      <div className="flex items-center pr-1.5 pl-1">{suffix}</div>
    </div>
  );
}
