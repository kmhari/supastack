import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/**
 * Two-column form row designed to live inside the shadcn <Card>
 * primitive. Mirrors the Supabase project Settings layout:
 *
 *   [ label + hint ]                  [ field         ]
 *
 * The parent Card's `divide-y` auto-draws a hairline between rows,
 * so consumers just stack <CardRow>s back-to-back.
 */
export function CardRow({
  label,
  hint,
  labelClassName,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  labelClassName?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid grid-cols-[1fr_minmax(0,1fr)] items-start gap-6 px-6 py-4">
      <div className={cn('pt-1', labelClassName)}>
        <Label className="text-sm font-normal text-foreground">{label}</Label>
        {hint && <div className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
