import { ExternalLink, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * Redirect URLs section: list of current entries (with per-entry delete)
 * + Add URL button + empty state. Cloud parity is enforced verbatim on
 * descriptions / empty-state copy in T018–T020.
 *
 * Spec: specs/022-url-configuration/spec.md US2, FR-005
 * Task: T013, T019
 */
export function RedirectUrlsList({
  urls,
  isAdmin,
  onDelete,
  onAddClick,
}: {
  urls: ReadonlyArray<string>;
  isAdmin: boolean;
  onDelete: (target: string) => void;
  onAddClick: () => void;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 text-xl font-normal tracking-tight text-foreground">
            Redirect URLs
          </h2>
          <p className="m-0 text-sm text-muted-foreground">
            URLs that auth providers are permitted to redirect to post authentication. Wildcards
            are allowed, for example, https://*.domain.com
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <a
            href="https://supabase.com/docs/guides/auth/redirect-urls"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background/40 px-3 py-1.5 text-sm text-foreground no-underline shadow-xs hover:bg-secondary"
          >
            Docs <ExternalLink className="size-3.5" />
          </a>
          {isAdmin ? (
            <Button type="button" variant="outline" size="sm" onClick={onAddClick}>
              <Plus className="size-3.5" /> Add URL
            </Button>
          ) : null}
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        {urls.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-12 text-center">
            <h3 className="m-0 text-base font-medium text-foreground">No Redirect URLs</h3>
            <p className="m-0 text-sm text-muted-foreground">
              Auth providers may need a URL to redirect back to
            </p>
          </div>
        ) : (
          <ul aria-label="Redirect URLs" className="m-0 flex list-none flex-col p-0">
            {urls.map((url) => (
              <li
                key={url}
                className="flex items-center gap-3 border-b border-border-soft px-4 py-3 last:border-b-0"
              >
                <span className="flex-1 truncate font-mono text-sm text-foreground">{url}</span>
                {isAdmin ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${url}`}
                    onClick={() => onDelete(url)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
