import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { looksLikeValidUrl } from './redirect-url-helpers';

/**
 * Site URL card. Single input + Save changes button.
 *
 * Spec: specs/022-url-configuration/spec.md US1, FR-004, FR-012
 * Data: specs/022-url-configuration/data-model.md SiteUrlState
 * Task: T009
 */
export function SiteUrlForm({
  initialValue,
  isAdmin,
  onSave,
}: {
  initialValue: string;
  isAdmin: boolean;
  onSave: (next: string) => void;
}): React.ReactElement {
  const [value, setValue] = useState(initialValue);
  useEffect(() => setValue(initialValue), [initialValue]);

  const trimmed = value.trim();
  const valid = looksLikeValidUrl(trimmed);
  const dirty = trimmed !== initialValue.trim();
  const canSave = isAdmin && valid && dirty;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="m-0 text-xl font-normal tracking-tight text-foreground">Site URL</h2>
      <Card className="p-5">
        <p className="m-0 mb-4 text-sm text-muted-foreground">
          Configure the default redirect URL used when a redirect URL is not specified or doesn't
          match one from the Redirect URLs list
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="site-url" className="font-normal text-foreground">
            Site URL
          </Label>
          <Input
            id="site-url"
            type="url"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!isAdmin}
            placeholder="https://app.example.com"
            aria-label="Site URL"
          />
        </div>
        {isAdmin ? (
          <div className="mt-5 flex justify-end border-t border-border-soft pt-4">
            <Button
              type="button"
              onClick={() => onSave(trimmed)}
              disabled={!canSave}
              className="bg-emerald-700 text-white hover:bg-emerald-600 disabled:bg-emerald-900/40 disabled:text-emerald-200/60"
            >
              Save changes
            </Button>
          </div>
        ) : null}
      </Card>
    </section>
  );
}
