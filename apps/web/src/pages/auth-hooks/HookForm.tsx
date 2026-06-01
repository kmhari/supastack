import { useState } from 'react';
import type { AuthConfigResponse } from '@/lib/api';

interface HookFormProps {
  hookType: string;
  label: string;
  description: string;
  config: AuthConfigResponse | undefined;
  isAdmin: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}

export function HookForm({
  hookType,
  label,
  description,
  config,
  isAdmin,
  onSave,
}: HookFormProps): React.ReactElement {
  const enabledKey = `hook_${hookType}_enabled` as keyof AuthConfigResponse;
  const uriKey = `hook_${hookType}_uri` as keyof AuthConfigResponse;
  const secretsKey = `hook_${hookType}_secrets` as keyof AuthConfigResponse;

  const [enabled, setEnabled] = useState(() => Boolean(config?.[enabledKey]));
  const [uri, setUri] = useState(() => String(config?.[uriKey] ?? ''));
  const [secrets, setSecrets] = useState(() => {
    const v = config?.[secretsKey];
    return v && v !== '***' ? String(v) : '';
  });

  const canSave = isAdmin && (!enabled || uri.trim() !== '');

  function handleSave(): void {
    void onSave({
      [enabledKey]: enabled,
      [uriKey]: uri.trim() || null,
      [secretsKey]: secrets.trim() || null,
    });
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border-soft/40 py-5 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{label}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
        <label className="flex cursor-pointer items-center gap-2">
          <span className="text-xs text-muted-foreground">{enabled ? 'Enabled' : 'Disabled'}</span>
          <input
            type="checkbox"
            checked={enabled}
            disabled={!isAdmin || !config}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-primary"
          />
        </label>
      </div>

      {enabled && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-foreground">URI</label>
            <input
              type="text"
              value={uri}
              disabled={!isAdmin}
              onChange={(e) => setUri(e.target.value)}
              placeholder="pg-functions://postgres/public/<func_name>"
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-foreground">
              Signing secret{' '}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              type="password"
              value={secrets}
              disabled={!isAdmin}
              onChange={(e) => setSecrets(e.target.value)}
              placeholder="v1,whsec_..."
              className="w-full rounded border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
