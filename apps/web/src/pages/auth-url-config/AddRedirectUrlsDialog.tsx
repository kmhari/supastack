import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  MAX_REDIRECT_URLS,
  dedupKey,
  looksLikeValidUrl,
} from './redirect-url-helpers';

type Row = { id: string; value: string; error: string | null };

let __rowSeq = 0;
function newRow(): Row {
  __rowSeq += 1;
  return { id: `r${__rowSeq}-${Date.now().toString(36)}`, value: '', error: null };
}

/**
 * Batch-add modal — mirrors Supabase Cloud verbatim. One URL input row to
 * start, internal "+ Add URL" appends rows, trash icon removes them, single
 * "Save URLs" submit PATCHes the merged list.
 *
 * Spec: specs/022-url-configuration/spec.md US2, FR-006, FR-007, FR-008, FR-009
 * Data: specs/022-url-configuration/data-model.md AddDialogState
 * Task: T014, T020
 */
export function AddRedirectUrlsDialog({
  open,
  onOpenChange,
  existingUrls,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingUrls: ReadonlyArray<string>;
  onSave: (newUrls: string[]) => void;
}): React.ReactElement {
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [topError, setTopError] = useState<string | null>(null);

  // Reset on every open so a closed-and-reopened dialog starts fresh.
  useEffect(() => {
    if (open) {
      setRows([newRow()]);
      setTopError(null);
    }
  }, [open]);

  function addRow(): void {
    setRows((rs) => [...rs, newRow()]);
  }

  function removeRow(id: string): void {
    setRows((rs) => {
      const next = rs.filter((r) => r.id !== id);
      // Lifecycle invariant: the dialog never shows zero rows (operator
      // closes the dialog instead of deleting the last row).
      return next.length === 0 ? [newRow()] : next;
    });
  }

  function setRowValue(id: string, value: string): void {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, value, error: null } : r)));
  }

  function handleSave(): void {
    setTopError(null);
    // Trim + drop empty rows
    const filled = rows
      .map((r) => ({ ...r, value: r.value.trim() }))
      .filter((r) => r.value.length > 0);

    if (filled.length === 0) {
      setTopError('Enter at least one URL.');
      return;
    }

    // Validate each
    const validated = filled.map((r) =>
      looksLikeValidUrl(r.value)
        ? { ...r, error: null }
        : {
            ...r,
            error: 'Must be a valid http(s) URL (wildcards allowed in path).',
          },
    );

    // Dedup batch against existing list
    const existingKeys = new Set(existingUrls.map(dedupKey));
    const batchKeys = new Set<string>();
    const deduped = validated.map((r) => {
      if (r.error) return r;
      const k = dedupKey(r.value);
      if (existingKeys.has(k)) {
        return { ...r, error: 'URL already added.' };
      }
      if (batchKeys.has(k)) {
        return { ...r, error: 'Duplicate of another row in this batch.' };
      }
      batchKeys.add(k);
      return r;
    });

    if (deduped.some((r) => r.error)) {
      setRows((rs) => {
        const map = new Map(deduped.map((r) => [r.id, r]));
        return rs.map((r) => map.get(r.id) ?? r);
      });
      return;
    }

    // Cap check
    if (existingUrls.length + deduped.length > MAX_REDIRECT_URLS) {
      setTopError(
        `Cap of ${MAX_REDIRECT_URLS} URLs reached. Remove some entries first.`,
      );
      return;
    }

    onSave(deduped.map((r) => r.value));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add new redirect URLs</DialogTitle>
          <DialogDescription>
            This will add a URL to a list of allowed URLs that can interact with your
            Authentication services for this project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          {rows.map((row, i) => (
            <div key={row.id} className="flex flex-col gap-1">
              <div className="flex items-end gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  {i === 0 ? (
                    <Label htmlFor={row.id} className="font-normal text-foreground">
                      URL
                    </Label>
                  ) : null}
                  <Input
                    id={row.id}
                    value={row.value}
                    onChange={(e) => setRowValue(row.id, e.target.value)}
                    placeholder="https://mydomain.com"
                    autoComplete="off"
                    aria-invalid={row.error ? 'true' : undefined}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove URL row"
                  onClick={() => removeRow(row.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
              {row.error ? (
                <p className="m-0 text-xs text-destructive" role="alert">
                  {row.error}
                </p>
              ) : null}
            </div>
          ))}

          <div>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="size-3.5" /> Add URL
            </Button>
          </div>

          {topError ? (
            <p className="m-0 text-sm text-destructive" role="alert">
              {topError}
            </p>
          ) : null}
        </div>

        <Button
          type="button"
          onClick={handleSave}
          className="w-full bg-emerald-700 text-white hover:bg-emerald-600"
        >
          Save URLs
        </Button>
      </DialogContent>
    </Dialog>
  );
}
