import * as React from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/**
 * Hidden honeypot pair that absorbs Chrome's persistent autofill on forms
 * containing a `type="password"` field. Chrome ignores `autocomplete="off"`
 * on such forms by design; the proven workaround is to expose a dummy
 * username + current-password pair earlier in the DOM that the browser
 * targets instead. Render this once near the top of any drawer that has a
 * client-secret field.
 */
export function AutofillTrap(): React.ReactElement {
  return (
    <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', top: '-9999px' }}>
      <input
        type="text"
        name="username"
        autoComplete="username"
        tabIndex={-1}
        defaultValue=""
        readOnly
      />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        tabIndex={-1}
        defaultValue=""
        readOnly
      />
    </div>
  );
}

/**
 * Shared form-row primitives for the auth-provider drawers.
 *
 * Visual: each row renders as a horizontal layout — label on the left,
 * control (input / toggle) on the right — separated by a thin border-bottom
 * line. Field labels are normal weight (no bold). Optional description text
 * sits below the label.
 */

export function FieldRow({
  id,
  label,
  description,
  children,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-6 border-b border-border-soft py-5 last:border-b-0">
      <div className="w-1/3 shrink-0">
        <Label htmlFor={id} className="font-normal text-foreground">
          {label}
        </Label>
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        {children}
        {description ? (
          <p className="m-0 mt-0.5 text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ToggleRow({
  id,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <div className="flex items-center gap-6 border-b border-border-soft py-5 last:border-b-0">
      <div className="flex flex-1 flex-col gap-1">
        <Label htmlFor={id} className="font-normal text-foreground">
          {label}
        </Label>
        {description ? <p className="m-0 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">
        <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}
