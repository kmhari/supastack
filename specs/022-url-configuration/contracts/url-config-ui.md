# Contract: URL Configuration UI Surface

**Type**: Frontend UI contract (not an HTTP API contract — feature is dashboard-only and reuses an existing endpoint)
**Date**: 2026-05-28
**Plan**: [`../plan.md`](../plan.md) | **Data model**: [`../data-model.md`](../data-model.md)

This contract specifies the externally-observable surface of the URL Configuration page. The implementation MAY change freely as long as this contract is honored.

---

## Route

| Field | Value |
|---|---|
| Path | `/dashboard/project/:ref/auth/url-configuration` |
| Component | `ProjectAuthUrlConfig` (default export from `apps/web/src/pages/ProjectAuthUrlConfig.tsx`) |
| Auth required | Yes (existing session middleware) |
| Roles | `admin` (read + write), `member` (read-only) |

---

## Query parameters

| Param | Required | Effect |
|---|---|---|
| — | — | None. The dialog open/close is local state and does not deep-link. |

---

## DOM contract (load order, observable selectors)

These selectors MUST be present and discoverable for the Playwright spec. UI styling is free to evolve.

```
<main>                                 # ProjectShell main area
  <h1>URL Configuration</h1>           # text-3xl page title
  <p>Configure site URL and redirect URLs for authentication</p>

  ─── Site URL section ──────────────
  <h2>Site URL</h2>                    # role=heading level=2 name="Site URL"
  <p>{description}</p>                 # Configure the default redirect URL used …
  <input aria-label="Site URL" />      # type=text, value seeded from authConfig.site_url
  <button>Save changes</button>        # disabled until input valid + dirty

  ─── Redirect URLs section ─────────
  <h2>Redirect URLs</h2>               # role=heading level=2 name="Redirect URLs"
  <p>{description}</p>                 # URLs that auth providers are permitted …
  <a href="https://supabase.com/docs/guides/auth/redirect-urls">Docs</a>
  <button>Add URL</button>             # opens AddRedirectUrlsDialog

  # When empty:
  <h3>No Redirect URLs</h3>
  <p>Auth providers may need a URL to redirect back to</p>

  # When non-empty:
  <ul aria-label="Redirect URLs">
    <li>
      <span>{url}</span>
      <button aria-label="Remove {url}">{trash icon}</button>  # admin only
    </li>
    …
  </ul>
</main>
```

### Modal (when Add URL is clicked)

```
<dialog role="dialog" aria-labelledby="add-redirect-title">
  <h2 id="add-redirect-title">Add new redirect URLs</h2>
  <p>This will add a URL to a list of allowed URLs that can interact with your Authentication services for this project.</p>

  <ul>
    <li>
      <label>URL</label>
      <input placeholder="https://mydomain.com" />
      <button aria-label="Remove URL row">{trash icon}</button>
    </li>
    …
  </ul>

  <button>+ Add URL</button>           # appends a row

  <button type="submit">Save URLs</button>  # primary action, green, full width
  <button aria-label="Close">×</button>
</dialog>
```

---

## State machine

```
[Page Open]
   │
   │ admin?
   ├── yes ──▶ [Read+Write View]
   └── no  ──▶ [Read-Only View]   # all inputs disabled, action buttons hidden

[Read+Write View]
   │
   ├── edit Site URL ─▶ [Site URL Dirty]
   │                      │
   │                      └─ submit ─▶ [Site URL Saving] ─▶ success ─▶ [Read+Write View]
   │                                                    └─ failure ─▶ [Site URL Dirty] + toast
   │
   ├── click Add URL ─▶ [Dialog Open, 1 empty row]
   │                      │
   │                      ├── + Add URL ─▶ append row
   │                      ├── trash row ─▶ remove row (re-append if last)
   │                      ├── Cancel ─▶ [Read+Write View]
   │                      └── Save URLs ─▶ validate
   │                                          │
   │                                          ├─ invalid ─▶ inline errors
   │                                          └─ valid ─▶ [Saving Batch] ─▶ success ─▶ [Read+Write View, list updated]
   │                                                                       └─ failure ─▶ toast, dialog stays open
   │
   └── click trash on list entry ─▶ [Deleting] ─▶ success ─▶ [Read+Write View, list updated]
                                                  └─ failure ─▶ toast, no list change
```

---

## RBAC contract

| Role | Site URL Save | Add URL button | Trash icon on list | Dialog can open |
|---|---|---|---|---|
| admin | enabled | visible | visible | yes |
| member | hidden | hidden | hidden | no |
| unauthenticated | (redirected to /login by existing middleware) | — | — | — |

---

## Backend contract reuse

This feature does **not** introduce any new HTTP endpoints. It uses:

| Endpoint | Verb | Already exists from |
|---|---|---|
| `/api/v1/projects/:ref/config/auth` | `GET` | feature 009 |
| `/api/v1/projects/:ref/config/auth` | `PATCH` | feature 009 (expanded by feature 020) |
| `/api/v1/projects/:ref/health` | `GET` | used by `use-restart-toast` |

The PATCH body for this feature is a strict subset:
```ts
type PatchBody = Partial<{
  site_url: string;
  uri_allow_list: string;
}>;
```

Other fields in the auth-config payload are not touched.

---

## Accessibility contract

| Requirement | How |
|---|---|
| Keyboard navigation | All inputs/buttons reachable via Tab; dialog traps focus (Radix Dialog handles this) |
| Screen reader labels | Inputs have `<label>` or `aria-label`; trash icons have `aria-label="Remove {url}"` |
| ESC closes dialog | Radix Dialog default behavior |
| Error announcement | Inline error text uses `aria-live="polite"` near the offending input |
| Color contrast | Inherits Tailwind theme; reuses error/success palettes already audited by feature 020 |

---

## i18n contract

English-only for v1 (matches Cloud and rest of supastack). All strings are inline; if i18n is ever added, this page is a candidate for the first sweep.

---

## Telemetry / observability

No new events. The PATCH endpoint already logs audit entries for auth-config changes (feature 020).

---

## Browser support

Same envelope as the rest of supastack web: modern evergreen browsers (Chromium ≥ 110, Firefox ≥ 110, Safari ≥ 16). WHATWG `URL` available everywhere.
