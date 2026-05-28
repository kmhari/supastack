import * as React from 'react';

import { cn } from '@/lib/utils';

function Input({ className, type, autoComplete, ...props }: React.ComponentProps<'input'>) {
  // Default every Input to autoComplete="off" so browsers stop pre-filling
  // unrelated fields with the operator's email/password. Login, Setup, and
  // any other field that NEEDS autofill should pass an explicit
  // autoComplete value (e.g. "email", "current-password", "new-password").
  // Password inputs default to "new-password" rather than "off" because
  // browsers ignore "off" on type=password but honor "new-password".
  const effectiveAutoComplete = autoComplete ?? (type === 'password' ? 'new-password' : 'off');
  return (
    <input
      type={type}
      autoComplete={effectiveAutoComplete}
      data-slot="input"
      className={cn(
        'h-9 w-full min-w-0 rounded-md border border-border bg-input px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
