# Contract — `/dashboard/cli/login` (React page)

**Purpose**: The page operators land on when the supabase CLI opens a browser. Validates query params, mints the PAT via `POST /api/v1/cli/login`, displays the verification code OR an error state.

**Route**: `/dashboard/cli/login` (apex host; lives in the existing dashboard catch-all).

**Auth**: Requires session cookie. Wrapped in `SetupGate`-style gate (or equivalent) that redirects to `/login?next=…` if unauthenticated.

---

## Query parameters (initial visit, from CLI)

| Param | Type | Required | Source |
|---|---|---|---|
| `session_id` | UUID v4 | Yes | CLI |
| `token_name` | string ≤200 chars | Yes | CLI |
| `public_key` | 130-char hex starting `04` | Yes | CLI |

After mint, the page calls `history.replaceState` to rewrite the URL to `/dashboard/cli/login?device_code=<code>` — drops the sensitive params from the URL bar.

---

## States

### State A — "loading" (initial mount, before mint completes)

Brief (<300ms typical). Shows a centered spinner or skeleton.

### State B — "code-display" (mint succeeded)

```
┌─────────────────────────────────────┐
│                                     │
│       [terminal icon] ⇄ [logo]      │
│                                     │
│      Authorize supastack CLI         │
│                                     │
│  Enter this verification code in    │
│   supastack CLI to finish signing in │
│                                     │
│   ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐ ┌─┐  │
│   │9│ │1│ │c│ │b│ │a│ │e│ │4│ │c│  │
│   └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘ └─┘  │
│                                     │
│   ┌────────── Copy code ──────────┐ │
│   └───────────────────────────────┘ │
│                                     │
│   ┌─────────────────────────────┐   │
│   │ [avatar]  Signed in as      │   │
│   │           hari@f22labs.com  │   │
│   └─────────────────────────────┘   │
│                                     │
│   After authorizing, you can close  │
│   this tab or manage tokens like    │
│   this one in [Access Tokens].      │
│                                     │
└─────────────────────────────────────┘
```

**Functional requirements:**

- The 8 character cells are visually separated boxes (one char per box)
- "Copy code" button uses `navigator.clipboard.writeText(code)`; flashes "Copied!" on success
- "Signed in as" pulls email from existing auth context
- "Access Tokens" link goes to `/settings/tokens`

### State C — "error" (replay OR validation failure OR 5xx)

```
┌─────────────────────────────────────┐
│                                     │
│       [terminal icon] ⇄ [logo]      │
│                                     │
│     Unable to create CLI sign-in    │
│                                     │
│   Retry the sign-in command from    │
│          supastack CLI               │
│                                     │
│   ┌─────────────────────────────┐   │
│   │ ⚠  supastack could not       │   │
│   │    create the CLI sign-in   │   │
│   │    session.                 │   │
│   │                             │   │
│   │    Error: <code or message> │   │
│   └─────────────────────────────┘   │
│                                     │
│   ┌──────── Back to dashboard ───┐  │
│   └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

Reached when:
- POST returned 409 `session_in_use` (replay)
- POST returned 422 `invalid_params`
- POST returned 5xx
- Query params missing or malformed on mount

"Back to dashboard" navigates to `/dashboard`.

---

## State transitions

```
mount
  │
  ├─ session cookie absent → redirect to /login?next=<full-path-with-query>
  │
  ├─ params malformed → State C (error, "invalid_params")
  │
  └─ params valid → State A (loading)
        │
        │ POST /api/v1/cli/login
        ▼
        ├─ 200 → State B (code-display, replaceState to ?device_code=…)
        ├─ 409 → State C (error, "session_in_use")
        ├─ 422 → State C (error, "invalid_params")
        ├─ 401 → redirect to /login?next=<full-path-with-query>
        └─ 5xx → State C (error, "server")
```

---

## Accessibility

- Verification code cells use `<code>` elements wrapped in a `<div role="group" aria-label="Verification code">`
- "Copy code" button announces success via `aria-live="polite"` on the "Copied!" feedback
- Error state's warning card uses `role="alert"`

---

## Tests

Component-level (Vitest + React Testing Library, optional for v1; the contract tests on the api side cover the wire shape). At minimum, manual exercise via the live VM after deploy:

1. Open URL with valid params while logged in → State B
2. Open same URL again → State C (replay)
3. Open URL with malformed `public_key` → State C (validation)
4. Open URL in incognito → bounce to `/login?next=…`, sign in, bounce back to State B
