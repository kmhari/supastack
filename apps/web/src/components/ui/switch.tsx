import * as React from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';

import { cn } from '@/lib/utils';

/**
 * shadcn-style Switch wrapper around Radix Switch. Used for boolean
 * auth-config toggles (Enable Sign in with X, Skip nonce checks, Allow
 * users without an email, etc.) matching Cloud's UX.
 */
function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-foreground/25 dark:data-[state=unchecked]:bg-foreground/20',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform',
          'data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0',
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
