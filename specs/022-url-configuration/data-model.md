# Phase 1 Data Model: URL Configuration page

**Date**: 2026-05-28
**Plan**: [`plan.md`](./plan.md)

This feature has **no database schema changes**. The data shapes below describe view-models, encoding conventions, and validation rules — not new tables.

---

## Storage layer (unchanged)

Auth-config rows in the per-project `auth_config` table already include:

| Column | Type | Description |
|---|---|---|
| `site_url` | `text` | The operator's frontend application URL (e.g. `https://app.example.com`). Honored by env-field-mapper → `SITE_URL` → `GOTRUE_SITE_URL`. **Empty/null after provisioning until operator sets it.** |
| `uri_allow_list` | `text` | Comma-separated list of allowed post-auth redirect URLs. Honored by env-field-mapper → `ADDITIONAL_REDIRECT_URLS` → `GOTRUE_URI_ALLOW_LIST`. Empty string = no entries. |

Both are NULL-tolerant in the schema; the dashboard layer enforces non-empty on `site_url` (per FR-012).

---

## View-models (frontend only)

### `SiteUrlState`

```ts
type SiteUrlState = {
  /** The current input value (controlled). */
  value: string;
  /** True when value differs from the most recently fetched authConfig.site_url. */
  dirty: boolean;
  /** True when value is a syntactically valid http/https URL (non-empty). */
  valid: boolean;
};
```

**Transitions**:
- Initial: `{ value: authConfig.site_url ?? '', dirty: false, valid: <derived> }`
- On change: recompute `dirty` (string compare against original) + `valid` (URL parse).
- On save success: replace `authConfig.site_url`; reset `dirty=false`.

### `RedirectUrlState`

```ts
type RedirectUrlState = {
  /** Parsed list, in insertion order. */
  urls: string[];
};
```

**Derivation**: `urls = authConfig.uri_allow_list.split(',').map(s => s.trim()).filter(Boolean)`.

**Mutation**:
- Add (single): `urls = [...urls, newUrl]`
- Add (batch from dialog): `urls = [...urls, ...validatedBatch]`
- Delete: `urls = urls.filter(u => u !== target)`

**Serialization back to PATCH body**: `uri_allow_list: urls.join(',')`.

### `AddDialogState`

```ts
type AddDialogRow = {
  /** Stable React key for the row (random uuid; not persisted). */
  id: string;
  /** The URL the operator is typing. May be empty (pending). */
  value: string;
  /** Per-row validation error, null if valid or empty. */
  error: string | null;
};

type AddDialogState = {
  open: boolean;
  rows: AddDialogRow[];
};
```

**Lifecycle**:
- Open: `{ open: true, rows: [{ id: uuid(), value: '', error: null }] }` — one empty row to start (matches Cloud).
- "+ Add URL" inside dialog: `rows = [...rows, { id: uuid(), value: '', error: null }]`.
- Trash on a row: `rows = rows.filter(r => r.id !== target)`. If `rows.length === 0` after delete, re-append an empty row (so the dialog never shows zero rows; user can always close instead).
- Save URLs click:
  1. Trim each `value`; drop empty rows.
  2. Validate each remaining `value` via `looksLikeValidUrl` (see R1).
  3. Mark rows with bad URLs by setting `error`.
  4. If any row has `error` — abort save, surface errors inline.
  5. Dedup batch against existing `urls` (case-insensitive scheme+host, exact path).
  6. If duplicate found — mark offending row with `"URL already added"`. Abort save.
  7. If `urls.length + batch.length > 50` — surface a dialog-level error "Cap of 50 URLs reached. Remove some entries first.". Abort save.
  8. PATCH `{ uri_allow_list: [...urls, ...batch].join(',') }`.
  9. On success: close dialog, restart toast.

---

## Validation rules

### URL syntax

```ts
function looksLikeValidUrl(input: string): boolean {
  if (!input || /\s/.test(input)) return false;
  const placeholder = input
    .replace(/\*\*/g, 'glob2')
    .replace(/\*/g, 'glob1')
    .replace(/\?/g, 'glob3');
  try {
    const u = new URL(placeholder);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
```

| Input | Accepted? | Reason |
|---|---|---|
| `http://localhost:3000` | ✓ | http scheme |
| `https://app.example.com` | ✓ | https scheme |
| `http://localhost:*` | ✓ | `*` → `glob1`, parses fine |
| `http://localhost:8765/**` | ✓ | `**` → `glob2`, parses fine |
| `http://*.example.com` | ✓ | host wildcards (operator's responsibility to know if GoTrue supports them) |
| `localhost:3000` | ✗ | missing scheme |
| `app.example.com` | ✗ | missing scheme |
| `javascript:alert(1)` | ✗ | scheme not in {http, https} |
| `data:text/html,foo` | ✗ | scheme not in {http, https} |
| `file:///etc/passwd` | ✗ | scheme not in {http, https} |
| `http:// trailing space` | ✗ | whitespace in input |
| `""` (empty) | ✗ | empty |
| `   ` (whitespace) | ✗ | whitespace |

### Duplicate detection

```ts
function dedupKey(input: string): string {
  try {
    const u = new URL(
      input
        .replace(/\*\*/g, 'glob2')
        .replace(/\*/g, 'glob1')
        .replace(/\?/g, 'glob3'),
    );
    const path = input.split(u.host).slice(1).join(u.host); // preserve original glob-bearing path
    return `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${path}`;
  } catch {
    return input; // can't parse — fall back to exact-string comparison
  }
}
```

| URL A | URL B | Duplicates? |
|---|---|---|
| `http://localhost:3000` | `http://Localhost:3000` | yes (host folded) |
| `HTTP://localhost:3000` | `http://localhost:3000` | yes (scheme folded) |
| `http://localhost:3000/foo` | `http://localhost:3000/foo/` | no (path byte-exact) |
| `http://localhost:3000/**` | `http://localhost:3000/**` | yes (identical) |
| `http://localhost:3000/?x=1` | `http://localhost:3000/?x=1` | yes (identical) |
| `http://localhost:3000` | `http://localhost:3000/` | yes (WHATWG normalises trailing slash) — see note |

> **Note on the last row**: WHATWG `URL` normalizes a missing path to `/`, so `new URL('http://localhost:3000').pathname === '/'`. This means `http://localhost:3000` and `http://localhost:3000/` fold to the same dedup key. This is harmless because GoTrue treats them identically too.

### Cap

```ts
const MAX_REDIRECT_URLS = 50;
```

Applies to the merged size: `existing.length + newBatch.length`. The dialog Save button shows a tooltip "Adding these N URLs would exceed the 50-URL cap" when violated.

---

## State / lifecycle diagram

```
                ┌──────────────────────────────┐
                │       Page loads (admin)     │
                └────────────────┬─────────────┘
                                 │
                                 ▼
                  GET /api/v1/projects/:ref/config/auth
                                 │
                                 ▼
                   ┌────────────────────────────┐
                   │ Seed SiteUrlState + UrlList │
                   └────────────────────────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
         [Edit Site URL]  [Click Add URL]  [Click trash on row]
                 │               │               │
                 ▼               ▼               ▼
         Save (PATCH)       Open dialog      PATCH (delete)
                 │               │               │
                 │               ▼               │
                 │     Batch rows + validate     │
                 │               │               │
                 │       PATCH (merged list)    │
                 │               │               │
                 └───────────────┼───────────────┘
                                 ▼
                       Restart toast polls
                       health for ~30s →
                       success or Retry
                                 │
                                 ▼
                Refetch authConfig (invalidate query)
                                 │
                                 ▼
                        Re-seed view-models
```

---

## Member-role view-model overrides

When `useAuth().user.role !== 'admin'`:
- `SiteUrlState.value` is read-only; input has `disabled` + `aria-readonly`.
- Save changes button is **hidden** (not just disabled — disabled buttons mislead members into thinking it's a transient state).
- Add URL button is hidden.
- Trash icons on each list row are hidden.
- Add dialog cannot be opened (no entry point).

---

## API contract (unchanged from feature 020)

### `GET /api/v1/projects/:ref/config/auth`

Returns (subset relevant here):
```json
{
  "site_url": "https://app.example.com",
  "uri_allow_list": "http://localhost:3000,http://localhost:8765/**",
  ...
}
```

### `PATCH /api/v1/projects/:ref/config/auth`

Accepts partial updates:
```json
{ "site_url": "https://new.example.com" }
```
or
```json
{ "uri_allow_list": "http://localhost:3000,http://localhost:8765/**,http://new.example.com" }
```

Server-side: env-field-mapper writes to `.env`, `composeUpService('auth')` recreates the container, healthcheck polled by client via restart toast.
