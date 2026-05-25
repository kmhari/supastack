import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Card primitive tuned to match supabase.com/dashboard cards 1:1:
 *  - softer outer border (border-border-soft = #2e2e2e) than the
 *    brighter --color-border that inputs use
 *  - rounded-lg, shadow-xs, overflow-hidden so per-section bg/borders
 *    don't bleed past the rounded corners
 *  - `divide-y` between direct children so CardHeader / CardContent /
 *    CardFooter automatically get hairline dividers without each
 *    consumer needing to wire it up
 *  - no internal gap (gap-0) and no outer padding — sections own
 *    their own px-6 py-4 padding, matching Supabase's section rhythm
 */
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col overflow-hidden rounded-lg border border-border-soft bg-card text-card-foreground shadow-xs divide-y divide-border-soft',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1 px-6 py-4 has-data-[slot=card-action]:grid-cols-[1fr_auto]',
        className,
      )}
      {...props}
    />
  );
}

function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('text-base font-medium leading-tight text-foreground', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-6 py-5', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center justify-end gap-2 px-6 py-3', className)}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
